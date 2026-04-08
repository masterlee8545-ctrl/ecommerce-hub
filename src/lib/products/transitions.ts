/**
 * 상품(products) 도메인 — 단계 전이 + 자동 task 생성
 *
 * 출처: docs/SPEC.md §3 (6단계), §7 (15종 task), ADR-005 (Idempotency Key)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 에러)
 *
 * 역할:
 * - 상품 status를 다음 단계로 전환
 * - product_state_history에 이력 기록 (Audit, ADR-010 — INSERT만)
 * - TRANSITION_TASK_MAP 기반으로 자동 task 생성
 * - 멱등성 키(ADR-005)로 같은 전이 재실행 시 task 중복 생성 방지
 *
 * 트랜잭션 원자성:
 * - 위 4가지 작업은 모두 같은 withCompanyContext 트랜잭션 내부에서 실행
 * - 어느 하나가 실패하면 전체 롤백 (UPDATE/history/tasks 모두 원복)
 *
 * 멱등성 동작:
 * - tasks 표의 idempotency_key UNIQUE 제약 (ADR-005)
 * - .onConflictDoNothing()으로 중복 INSERT 시 silently 무시
 * - returning() 행 개수로 실제 생성된 task 수 측정 가능
 */
import { and, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { products, productStateHistory, tasks, type NewTask } from '@/db/schema';

import {
  buildTransitionIdempotencyKey,
  NEXT_STAGES,
  PIPELINE_STAGES,
  TRANSITION_TASK_MAP,
  type PipelineStage,
} from './constants';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const MAX_REASON_LEN = 500;
const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────
// 입력 / 출력 타입
// ─────────────────────────────────────────────────────────

export interface TransitionProductStatusInput {
  companyId: string;
  productId: string;
  /** 전환할 다음 단계 (NEXT_STAGES 매핑에 있어야 함) */
  toStatus: PipelineStage;
  /** 누가 바꿨는지 (NextAuth user.id, 선택) */
  changedBy?: string | null;
  /** 사용자 입력 사유 (선택) — 500자 제한 */
  reason?: string | null;
}

export interface TransitionProductStatusResult {
  productId: string;
  fromStatus: PipelineStage;
  toStatus: PipelineStage;
  /** 실제로 새로 생성된 task 수 (멱등 충돌은 제외) */
  tasksCreated: number;
  /** 매핑에 정의된 총 task 수 */
  tasksPlanned: number;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

function validateTransitionAllowed(from: PipelineStage, to: PipelineStage): void {
  const allowed = NEXT_STAGES[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `[transitionProductStatus] '${from}' 단계에서 '${to}' 단계로 직접 전환할 수 없습니다. ` +
        `허용된 다음 단계: ${allowed.length === 0 ? '(없음 — 최종 단계)' : allowed.join(', ')}`,
    );
  }
}

function validateReason(reason: string | null | undefined): void {
  if (reason == null) return;
  if (reason.length > MAX_REASON_LEN) {
    throw new Error(`[transitionProductStatus] 사유가 너무 깁니다 (최대 ${MAX_REASON_LEN}자).`);
  }
}

// ─────────────────────────────────────────────────────────
// 핵심 — 단계 전환
// ─────────────────────────────────────────────────────────

/**
 * 상품의 단계를 다음 단계로 전환하고 자동 task를 생성한다.
 *
 * 흐름 (모두 단일 트랜잭션):
 * 1. SELECT 상품 → 현재 status 확인 (없으면 throw)
 * 2. NEXT_STAGES[현재]에 toStatus가 있는지 검증
 * 3. UPDATE products.status + updated_at
 * 4. INSERT product_state_history (from, to, changedBy, reason)
 * 5. TRANSITION_TASK_MAP[from:to]의 각 task 명세를 INSERT
 *    - idempotency_key로 중복 방지 (.onConflictDoNothing)
 *
 * @returns 전환 결과 + 새로 생성된 task 수
 * @throws 상품을 찾을 수 없거나 전이가 허용되지 않으면
 */
export async function transitionProductStatus(
  input: TransitionProductStatusInput,
): Promise<TransitionProductStatusResult> {
  if (!input.companyId || !input.productId) {
    throw new Error('[transitionProductStatus] companyId와 productId가 필요합니다.');
  }
  if (!isPipelineStage(input.toStatus)) {
    throw new Error(`[transitionProductStatus] 유효하지 않은 단계: ${input.toStatus}`);
  }
  validateReason(input.reason);

  return withCompanyContext(input.companyId, async (tx) => {
    // ─── 1. 현재 상품 조회 ───
    const rows = await tx
      .select({ id: products.id, status: products.status })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.company_id, input.companyId)))
      .limit(1);

    const current = rows[0];
    if (!current) {
      throw new Error(
        `[transitionProductStatus] 상품을 찾을 수 없습니다: ${input.productId} ` +
          `(다른 회사 소속이거나 삭제되었을 수 있습니다)`,
      );
    }

    if (!isPipelineStage(current.status)) {
      throw new Error(
        `[transitionProductStatus] 상품의 현재 status가 비정상입니다: ${current.status}`,
      );
    }

    const fromStatus: PipelineStage = current.status;
    const toStatus: PipelineStage = input.toStatus;

    // 같은 단계로의 "전환"은 의미 없음 — 명시적 에러
    if (fromStatus === toStatus) {
      throw new Error(
        `[transitionProductStatus] 이미 '${fromStatus}' 단계입니다. 다음 단계로만 전환할 수 있습니다.`,
      );
    }

    // ─── 2. 전이 허용 여부 검증 ───
    validateTransitionAllowed(fromStatus, toStatus);

    // ─── 3. products.status 업데이트 ───
    const now = new Date();
    await tx
      .update(products)
      .set({ status: toStatus, updated_at: now })
      .where(eq(products.id, input.productId));

    // ─── 4. product_state_history 기록 (Immutable Audit) ───
    await tx.insert(productStateHistory).values({
      company_id: input.companyId,
      product_id: input.productId,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: input.changedBy ?? null,
      changed_at: now,
      reason: input.reason ?? null,
    });

    // ─── 5. 자동 task 생성 (TRANSITION_TASK_MAP + 멱등 키) ───
    const transitionKey = `${fromStatus}:${toStatus}`;
    const taskSpecs = TRANSITION_TASK_MAP[transitionKey] ?? [];

    let tasksCreated = 0;
    for (const spec of taskSpecs) {
      const idempotencyKey = buildTransitionIdempotencyKey(
        input.productId,
        fromStatus,
        toStatus,
        spec.taskType,
      );

      const dueAt =
        spec.daysUntilDue > 0 ? new Date(now.getTime() + spec.daysUntilDue * MS_PER_DAY) : null;

      const newTask: NewTask = {
        company_id: input.companyId,
        product_id: input.productId,
        task_type: spec.taskType,
        title: spec.title,
        status: 'pending',
        priority: spec.priority,
        due_at: dueAt,
        idempotency_key: idempotencyKey,
        created_by: input.changedBy ?? null,
        source: 'auto',
      };

      // ADR-005: idempotency_key UNIQUE 충돌 시 silently 무시
      const inserted = await tx
        .insert(tasks)
        .values(newTask)
        .onConflictDoNothing({ target: tasks.idempotency_key })
        .returning({ id: tasks.id });

      if (inserted.length > 0) tasksCreated += 1;
    }

    return {
      productId: input.productId,
      fromStatus,
      toStatus,
      tasksCreated,
      tasksPlanned: taskSpecs.length,
    };
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 상품 이력
// ─────────────────────────────────────────────────────────

/**
 * 상품의 단계 이력 조회 (최신순).
 * 상세 페이지에서 "이 상품이 어떤 단계를 거쳐왔는지" 표시할 때 사용.
 */
export async function listProductStateHistory(
  companyId: string,
  productId: string,
): Promise<
  Array<{
    fromStatus: string | null;
    toStatus: string;
    changedAt: Date;
    changedBy: string | null;
    reason: string | null;
  }>
> {
  if (!companyId || !productId) {
    throw new Error('[listProductStateHistory] companyId와 productId가 필요합니다.');
  }

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({
        from_status: productStateHistory.from_status,
        to_status: productStateHistory.to_status,
        changed_at: productStateHistory.changed_at,
        changed_by: productStateHistory.changed_by,
        reason: productStateHistory.reason,
      })
      .from(productStateHistory)
      .where(
        and(
          eq(productStateHistory.product_id, productId),
          eq(productStateHistory.company_id, companyId),
        ),
      );

    // 최신순 정렬 (DB ORDER BY 대신 JS — 작은 데이터)
    return rows
      .sort((a, b) => b.changed_at.getTime() - a.changed_at.getTime())
      .map((r) => ({
        fromStatus: r.from_status,
        toStatus: r.to_status,
        changedAt: r.changed_at,
        changedBy: r.changed_by,
        reason: r.reason,
      }));
  });
}
