/**
 * 작업(tasks) 도메인 — 쿼리 + 변경 헬퍼
 *
 * 출처: src/db/schema/tasks.ts, docs/DATA_MODEL.md §5.1, ADR-005
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-1 (빈 결과 은폐 금지)
 *
 * 역할:
 * - 회사별 작업 목록 조회 (상태 필터 가능)
 * - 작업 상태 변경 (pending → in_progress → done)
 * - 작업 단건 조회
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS 자동 적용.
 *
 * 작업 상태:
 * - pending: 대기중
 * - in_progress: 진행중
 * - review: 검토 필요
 * - done: 완료
 * - cancelled: 취소됨
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { tasks, type Task } from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 상수 + 타입
// ─────────────────────────────────────────────────────────

export const TASK_STATUSES = ['pending', 'in_progress', 'review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** "열려 있는" 작업 = 끝나지 않은 모든 상태 */
export const OPEN_TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'review'];

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListTasksParams {
  companyId: string;
  /** 특정 상태만 보고 싶을 때. 빈 배열 / undefined면 전체. */
  statuses?: TaskStatus[];
  /** "열려 있는 작업만" — true면 OPEN_TASK_STATUSES로 자동 필터링 */
  openOnly?: boolean;
  limit?: number;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * URL 검색 파라미터에서 status 필터 파싱.
 * 예: ?status=pending,in_progress → ['pending','in_progress']
 * 잘못된 값은 조용히 무시 (P-1: 빈 결과는 명시).
 */
export function parseTaskStatusFilter(raw: string | null | undefined): TaskStatus[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TaskStatus => isTaskStatus(s));
}

// ─────────────────────────────────────────────────────────
// 조회 — 목록
// ─────────────────────────────────────────────────────────

/**
 * 회사의 작업 목록 조회.
 * 정렬: 마감일(없으면 마지막), 우선순위, 최신 등록 순.
 */
export async function listTasks(params: ListTasksParams): Promise<Task[]> {
  if (!params.companyId) {
    throw new Error('[listTasks] companyId가 필요합니다.');
  }
  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  // 상태 필터: openOnly가 true면 우선 적용, 아니면 statuses 사용
  const effectiveStatuses =
    params.openOnly === true
      ? OPEN_TASK_STATUSES
      : params.statuses && params.statuses.length > 0
        ? params.statuses
        : null;

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [eq(tasks.company_id, params.companyId)];
    if (effectiveStatuses) {
      conditions.push(inArray(tasks.status, effectiveStatuses));
    }

    const rows = await tx
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(
        // 마감일 빠른 것 먼저 (NULL은 마지막)
        sql`${tasks.due_at} ASC NULLS LAST`,
        desc(tasks.created_at),
      )
      .limit(limit);
    return rows;
  });
}

/**
 * 회사의 작업 상태별 카운트 (필터 칩 옆 숫자용).
 */
export async function countTasksByStatus(
  companyId: string,
): Promise<Record<TaskStatus, number>> {
  if (!companyId) {
    throw new Error('[countTasksByStatus] companyId가 필요합니다.');
  }

  const initial: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    cancelled: 0,
  };

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ status: tasks.status, n: count() })
      .from(tasks)
      .where(eq(tasks.company_id, companyId))
      .groupBy(tasks.status);

    for (const row of rows) {
      if (isTaskStatus(row.status)) {
        initial[row.status] = Number(row.n);
      }
    }
    return initial;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 단건
// ─────────────────────────────────────────────────────────

export async function getTaskById(companyId: string, taskId: string): Promise<Task | null> {
  if (!companyId || !taskId) {
    throw new Error('[getTaskById] companyId와 taskId가 필요합니다.');
  }
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ?? null;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 특정 상품들의 작업 (대시보드 N+1 방지)
// ─────────────────────────────────────────────────────────

export interface ListTasksForProductsParams {
  companyId: string;
  productIds: string[];
  /** true면 OPEN_TASK_STATUSES만 반환 */
  openOnly?: boolean;
}

/**
 * 주어진 여러 상품에 연결된 작업을 한 번에 조회.
 * /importing, /listing 등 "단계별 상품 대시보드"에서 N+1 쿼리를 방지하기 위한 헬퍼.
 *
 * - productIds가 비어 있으면 바로 [] 반환 (쿼리 안 함)
 * - 정렬: 마감 빠른 순 → 최신 등록 순 (listTasks와 동일)
 * - 호출자가 product_id별로 그룹화해서 사용할 수 있게 Task[]를 통째로 반환
 */
export async function listTasksForProducts(
  params: ListTasksForProductsParams,
): Promise<Task[]> {
  if (!params.companyId) {
    throw new Error('[listTasksForProducts] companyId가 필요합니다.');
  }
  if (params.productIds.length === 0) return [];

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [
      eq(tasks.company_id, params.companyId),
      inArray(tasks.product_id, params.productIds),
    ];
    if (params.openOnly === true) {
      conditions.push(inArray(tasks.status, OPEN_TASK_STATUSES));
    }

    const rows = await tx
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(sql`${tasks.due_at} ASC NULLS LAST`, desc(tasks.created_at));
    return rows;
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 상태 전환
// ─────────────────────────────────────────────────────────

export interface UpdateTaskStatusInput {
  companyId: string;
  taskId: string;
  status: TaskStatus;
}

/**
 * 작업 상태 변경.
 * - in_progress 진입 시 started_at 자동 기록
 * - done 진입 시 completed_at 자동 기록
 */
export async function updateTaskStatus(input: UpdateTaskStatusInput): Promise<void> {
  if (!input.companyId || !input.taskId) {
    throw new Error('[updateTaskStatus] companyId와 taskId가 필요합니다.');
  }
  if (!isTaskStatus(input.status)) {
    throw new Error(`[updateTaskStatus] 유효하지 않은 상태: ${input.status}`);
  }

  const now = new Date();
  const patch: Partial<typeof tasks.$inferInsert> = {
    status: input.status,
  };
  if (input.status === 'in_progress') patch.started_at = now;
  if (input.status === 'done') patch.completed_at = now;

  await withCompanyContext(input.companyId, async (tx) => {
    await tx.update(tasks).set(patch).where(eq(tasks.id, input.taskId));
  });
}
