/**
 * /tasks — 작업 목록 페이지
 *
 * 출처: docs/SPEC.md §7 (15종 task_type), D-3a
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 회사의 작업 목록을 마감일/우선순위 순으로 보여줌
 * - 상태 필터 칩 (전체 / 열린 작업 / 대기 / 진행중 / 검토 / 완료 / 취소)
 * - 각 행에 인라인 상태 변경 버튼 (Server Action)
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 인증 + 회사 컨텍스트
 * 2. listTasks + countTasksByStatus 병렬 호출 — RLS 자동
 * 3. URL searchParams로 필터 상태 유지
 *
 * 보안 (P-4):
 * - withCompanyContext 안에서 쿼리 → 다른 회사 작업 0% 노출
 */
import Link from 'next/link';

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ListTodo,
  PauseCircle,
  PlayCircle,
  XCircle,
} from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { updateTaskStatusAction } from '@/lib/tasks/actions';
import {
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  countTasksByStatus,
  listTasks,
  parseTaskStatusFilter,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/queries';

export const dynamic = 'force-dynamic';

const TASKS_LIMIT = 100;

interface TasksPageProps {
  searchParams: Promise<{ status?: string }>;
}

// ─────────────────────────────────────────────────────────
// 상태 메타
// ─────────────────────────────────────────────────────────

const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; icon: typeof Circle }
> = {
  pending: { label: '대기', color: 'text-navy-600 bg-navy-50', icon: Circle },
  in_progress: { label: '진행중', color: 'text-blue-700 bg-blue-50', icon: PlayCircle },
  review: { label: '검토', color: 'text-purple-700 bg-purple-50', icon: PauseCircle },
  done: { label: '완료', color: 'text-emerald-700 bg-emerald-50', icon: CheckCircle2 },
  cancelled: { label: '취소', color: 'text-navy-400 bg-navy-50', icon: XCircle },
};

const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: '🔥 긴급', color: 'text-red-700 bg-red-50' },
  high: { label: '높음', color: 'text-orange-700 bg-orange-50' },
  normal: { label: '보통', color: 'text-navy-600 bg-navy-50' },
  low: { label: '낮음', color: 'text-navy-400 bg-navy-50' },
};

// 다음 상태 후보 (현재 상태에서 한 번에 갈 수 있는 상태)
const NEXT_STATUSES: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['review', 'done', 'pending'],
  review: ['done', 'in_progress'],
  done: ['in_progress'],
  cancelled: ['pending'],
};

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const ctx = await requireCompanyContext();
  const sp = await searchParams;
  const statusFilter = parseTaskStatusFilter(sp.status);

  // DB 조회 — 빈 목록이거나 DB 미준비 시 폴백
  let rows: Awaited<ReturnType<typeof listTasks>> = [];
  let counts: Awaited<ReturnType<typeof countTasksByStatus>> = {
    pending: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    cancelled: 0,
  };
  let dbError: string | null = null;

  try {
    [rows, counts] = await Promise.all([
      listTasks({
        companyId: ctx.companyId,
        statuses: statusFilter,
        limit: TASKS_LIMIT,
      }),
      countTasksByStatus(ctx.companyId),
    ]);
  } catch (err) {
    console.error('[tasks] 조회 실패:', err);
    dbError =
      err instanceof Error
        ? `작업 목록 조회 중 오류: ${err.message}`
        : '작업 목록을 불러올 수 없습니다.';
  }

  const totalCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const openCount = counts.pending + counts.in_progress + counts.review;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-700">
          <ListTodo className="h-4 w-4" aria-hidden />할 일 관리
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">작업 ({totalCount}건)</h1>
        <p className="mt-1 text-sm text-navy-500">
          시스템 전체의 To-Do 리스트입니다. 자동 생성 작업과 수동 작업이 모두 모여 있습니다.
          상태별 칩을 눌러 필터링하세요.
        </p>
      </header>

      {/* 필터 칩 */}
      <FilterChips counts={counts} totalCount={totalCount} openCount={openCount} active={statusFilter} />

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel filtered={statusFilter.length > 0} />
      ) : (
        <ul className="space-y-2">
          {rows.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 필터 칩
// ─────────────────────────────────────────────────────────

interface FilterChipsProps {
  counts: Record<TaskStatus, number>;
  totalCount: number;
  openCount: number;
  active: TaskStatus[];
}

function FilterChips({ counts, totalCount, openCount, active }: FilterChipsProps) {
  // "전체"와 "열린 작업"은 가상 칩
  const isAll = active.length === 0;
  const isOpenOnly =
    active.length === OPEN_TASK_STATUSES.length &&
    OPEN_TASK_STATUSES.every((s) => active.includes(s));

  const openHref = `/tasks?status=${OPEN_TASK_STATUSES.join(',')}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip href="/tasks" active={isAll} label="전체" count={totalCount} />
      <FilterChip href={openHref} active={isOpenOnly} label="열린 작업" count={openCount} accent="orange" />
      {TASK_STATUSES.map((status) => {
        const isActive = !isOpenOnly && active.length === 1 && active[0] === status;
        const meta = STATUS_META[status];
        return (
          <FilterChip
            key={status}
            href={`/tasks?status=${status}`}
            active={isActive}
            label={meta.label}
            count={counts[status]}
          />
        );
      })}
    </div>
  );
}

interface FilterChipProps {
  href: string;
  active: boolean;
  label: string;
  count: number;
  accent?: 'orange';
}

function FilterChip({ href, active, label, count, accent }: FilterChipProps) {
  const baseColor = accent === 'orange' ? 'border-orange-300 bg-orange-50 text-orange-700' : '';
  const className = active
    ? 'rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 transition'
    : `rounded-full border border-navy-200 bg-white px-3 py-1 text-xs font-semibold text-navy-600 transition hover:border-teal-300 hover:text-teal-700 ${baseColor}`;

  return (
    <Link href={href} className={className}>
      {label}
      <span className="ml-1.5 font-mono text-[10px] text-navy-400">{count}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 행
// ─────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Awaited<ReturnType<typeof listTasks>>[number];
}

function TaskRow({ task }: TaskRowProps) {
  const statusMeta =
    STATUS_META[task.status as TaskStatus] ?? STATUS_META.pending;
  const priorityMeta =
    PRIORITY_META[task.priority as TaskPriority] ?? PRIORITY_META.normal;
  const StatusIcon = statusMeta.icon;
  const nextOptions = NEXT_STATUSES[task.status as TaskStatus] ?? [];

  const overdue =
    task.due_at !== null &&
    task.due_at < new Date() &&
    task.status !== 'done' &&
    task.status !== 'cancelled';

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        {/* 좌측: 본문 */}
        <div className="min-w-0 flex-1">
          {/* 상단 메타 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${statusMeta.color}`}
            >
              <StatusIcon className="h-3 w-3" aria-hidden />
              {statusMeta.label}
            </span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${priorityMeta.color}`}>
              {priorityMeta.label}
            </span>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 font-mono text-navy-600">
              {task.task_type}
            </span>
            {task.source === 'auto' && (
              <span className="rounded bg-yellow-50 px-1.5 py-0.5 text-yellow-700">자동 생성</span>
            )}
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                기한 초과
              </span>
            )}
          </div>

          {/* 제목 */}
          <h3 className="mt-2 text-sm font-semibold text-navy-900">{task.title}</h3>

          {/* 설명 */}
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-navy-600">{task.description}</p>
          )}

          {/* 마감일 */}
          {task.due_at && (
            <div
              className={`mt-2 inline-flex items-center gap-1 text-[11px] ${
                overdue ? 'font-semibold text-red-700' : 'text-navy-500'
              }`}
            >
              <Clock className="h-3 w-3" aria-hidden />
              마감 {formatDateTime(task.due_at)}
            </div>
          )}
        </div>

        {/* 우측: 상태 변경 버튼 */}
        {nextOptions.length > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-[10px] text-navy-400">다음 상태로</span>
            <div className="flex flex-col gap-1">
              {nextOptions.map((next) => (
                <StatusButton key={next} taskId={task.id} nextStatus={next} />
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 상태 변경 버튼 (Server Action 폼)
// ─────────────────────────────────────────────────────────

function StatusButton({ taskId, nextStatus }: { taskId: string; nextStatus: TaskStatus }) {
  const meta = STATUS_META[nextStatus];
  return (
    <form action={updateTaskStatusAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="status" value={nextStatus} />
      <button
        type="submit"
        className={`inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-[10px] font-semibold transition hover:border-current ${meta.color}`}
      >
        <meta.icon className="h-3 w-3" aria-hidden />
        {meta.label}으로
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <ListTodo className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">
        {filtered ? '필터에 해당하는 작업이 없습니다' : '아직 작업이 없습니다'}
      </h2>
      <p className="mt-1 text-xs text-navy-500">
        {filtered
          ? '다른 필터를 선택해보세요. 위 칩에서 "전체"를 누르면 모든 작업이 표시됩니다.'
          : '상품을 등록하고 단계를 변경하면 자동으로 작업이 생성됩니다.'}
      </p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">작업 목록을 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결 또는 마이그레이션 적용을 확인하세요. (`npm run db:push`)
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  try {
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(date);
  }
}
