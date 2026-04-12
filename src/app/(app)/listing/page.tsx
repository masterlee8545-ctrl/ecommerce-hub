/**
 * /listing — 상세페이지 / 등록 (Step 4)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - listing 단계 상품 목록 (상세페이지 디자인 + 쿠팡/네이버 등록 대기)
 * - 각 상품별 자동 생성 작업 진행률 표시
 * - 작업 완료 시 "런칭/마케팅으로" 전환 버튼
 * - 직원이 로그인해서 직접 작업하는 화면
 */
import Link from 'next/link';

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ListChecks,
  PackageSearch,
  Play,
  Rocket,
} from 'lucide-react';

import type { Product, Task } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { transitionProductStatusAction } from '@/lib/products/actions';
import { listProducts } from '@/lib/products/queries';
import { updateTaskStatusAction } from '@/lib/tasks/actions';
import {
  listTasksForProducts,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/queries';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 50;
const PERCENT_MAX = 100;
const MAX_TASK_PREVIEW = 5;

const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  pending: { label: '대기', color: 'text-navy-600', bgColor: 'bg-navy-50' },
  in_progress: { label: '진행중', color: 'text-teal-700', bgColor: 'bg-teal-50' },
  review: { label: '검토', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  done: { label: '완료', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  cancelled: { label: '취소', color: 'text-navy-400', bgColor: 'bg-navy-50' },
};

const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: '긴급', color: 'text-red-600' },
  high: { label: '높음', color: 'text-amber-600' },
  normal: { label: '보통', color: 'text-navy-500' },
  low: { label: '낮음', color: 'text-navy-400' },
};

const NEXT_STATUS_ACTION: Record<
  TaskStatus,
  { nextStatus: TaskStatus; label: string; icon: 'play' | 'check' } | null
> = {
  pending: { nextStatus: 'in_progress', label: '시작', icon: 'play' },
  in_progress: { nextStatus: 'done', label: '완료', icon: 'check' },
  review: { nextStatus: 'done', label: '완료', icon: 'check' },
  done: null,
  cancelled: null,
};

export default async function ListingPage() {
  const ctx = await requireCompanyContext();

  let listingProducts: Product[] = [];
  let dbError: string | null = null;
  try {
    listingProducts = await listProducts({
      companyId: ctx.companyId,
      stages: ['listing'],
      limit: LIST_LIMIT,
    });
  } catch (err) {
    console.error('[listing] 상품 조회 실패:', err);
    dbError = err instanceof Error ? err.message : '상품을 불러올 수 없습니다.';
  }

  // 상품별 작업 조회
  const productIds = listingProducts.map((p) => p.id);
  let productTasks: Task[] = [];
  try {
    if (productIds.length > 0) {
      productTasks = await listTasksForProducts({
        companyId: ctx.companyId,
        productIds,
        openOnly: false,
      });
    }
  } catch (err) {
    console.error('[listing] 작업 조회 실패:', err);
  }

  const tasksByProductId = new Map<string, Task[]>();
  for (const t of productTasks) {
    if (!t.product_id) continue;
    const arr = tasksByProductId.get(t.product_id) ?? [];
    arr.push(t);
    tasksByProductId.set(t.product_id, arr);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-600">
          <PackageSearch className="h-4 w-4" aria-hidden />
          Step 4
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">상세페이지 / 등록</h1>
        <p className="mt-1 text-sm text-navy-500">
          상세페이지 디자인, 상품 촬영, 쿠팡/네이버 등록 작업을 관리합니다.
          모든 작업이 끝나면 런칭 단계로 넘깁니다.
        </p>
      </header>

      {/* 본문 */}
      {dbError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
          <div className="font-semibold text-amber-900">데이터를 불러올 수 없습니다</div>
          <p className="mt-1 text-xs">{dbError}</p>
        </div>
      ) : listingProducts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
          <PackageSearch className="mx-auto h-10 w-10 text-navy-300" />
          <h3 className="mt-3 text-base font-semibold text-navy-700">
            등록 대기 상품이 없습니다
          </h3>
          <p className="mt-1 text-xs text-navy-500">
            수입 완료 후 이 단계로 넘어온 상품이 여기 표시됩니다.
          </p>
          <Link
            href="/importing"
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-800"
          >
            수입중 화면 보기 →
          </Link>
        </div>
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
            등록 작업 중 ({listingProducts.length}개)
          </h2>
          <ul className="space-y-3">
            {listingProducts.map((product) => (
              <ListingCard
                key={product.id}
                product={product}
                tasks={tasksByProductId.get(product.id) ?? []}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 등록 상품 카드
// ─────────────────────────────────────────────────────────

interface ListingCardProps {
  product: Product;
  tasks: Task[];
}

function ListingCard({ product, tasks }: ListingCardProps) {
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
  const activeTotal = total - cancelledCount;
  const progressPercent = activeTotal > 0 ? Math.round((doneCount / activeTotal) * PERCENT_MAX) : 0;
  const allDone = activeTotal > 0 && doneCount === activeTotal;

  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const previewTasks = openTasks.slice(0, MAX_TASK_PREVIEW);
  const hiddenCount = Math.max(0, openTasks.length - MAX_TASK_PREVIEW);

  return (
    <li className={`rounded-lg border p-4 ${allDone ? 'border-emerald-300 bg-emerald-50/20' : 'border-navy-200 bg-white'}`}>
      {/* 상단: 상품 정보 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/products/${product.id}`}
              className="text-sm font-semibold text-navy-900 hover:text-teal-700"
            >
              {product.name}
            </Link>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
              {product.code}
            </span>
          </div>
          {product.category && (
            <p className="mt-0.5 text-xs text-navy-500">{product.category}</p>
          )}
        </div>

        {/* 런칭으로 넘기기 */}
        <form action={transitionProductStatusAction}>
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="toStatus" value="active" />
          <button
            type="submit"
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              allDone
                ? 'bg-teal-600 text-white hover:bg-teal-700'
                : 'border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100'
            }`}
          >
            <Rocket className="h-3 w-3" />
            런칭으로
            {allDone && <ArrowRight className="h-3 w-3" />}
          </button>
        </form>
      </div>

      {/* 작업 진행률 */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 font-semibold text-navy-600">
            <ListChecks className="h-3 w-3" aria-hidden />
            작업 진행률
          </span>
          <span className="font-mono text-navy-500">
            {doneCount}/{activeTotal}
            {allDone && <span className="ml-1 text-emerald-600">✓ 완료</span>}
          </span>
        </div>
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-navy-100"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={PERCENT_MAX}
        >
          <div
            className={`h-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-orange-500'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 작업 목록 */}
      {previewTasks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {previewTasks.map((t) => {
            const status = t.status as TaskStatus;
            const priority = t.priority as TaskPriority;
            const statusMeta = TASK_STATUS_META[status];
            const priorityMeta = PRIORITY_META[priority];
            const nextAction = NEXT_STATUS_ACTION[status];
            return (
              <li key={t.id} className="flex items-center gap-2 text-[11px] text-navy-700">
                <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${statusMeta.bgColor} ${statusMeta.color}`}>
                  {statusMeta.label}
                </span>
                <span className="truncate">{t.title}</span>
                {(priority === 'urgent' || priority === 'high') && (
                  <span className={`shrink-0 text-[9px] font-semibold ${priorityMeta.color}`}>
                    [{priorityMeta.label}]
                  </span>
                )}
                {t.due_at && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-navy-400">
                    <Clock className="h-2.5 w-2.5" aria-hidden />
                    {formatShortDate(t.due_at)}
                  </span>
                )}
                {nextAction && (
                  <form action={updateTaskStatusAction} className={t.due_at ? '' : 'ml-auto'}>
                    <input type="hidden" name="taskId" value={t.id} />
                    <input type="hidden" name="status" value={nextAction.nextStatus} />
                    <button
                      type="submit"
                      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[9px] font-semibold text-teal-700 hover:bg-teal-100"
                    >
                      {nextAction.icon === 'play' ? (
                        <Play className="h-2.5 w-2.5" aria-hidden />
                      ) : (
                        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />
                      )}
                      {nextAction.label}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li className="text-[10px] text-navy-400">+ {hiddenCount}개 더</li>
          )}
        </ul>
      )}
      {total === 0 && (
        <p className="mt-2 text-[11px] text-navy-400">
          자동 생성 작업이 없습니다.
        </p>
      )}
    </li>
  );
}

function formatShortDate(date: Date): string {
  try {
    return date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
  } catch {
    return String(date);
  }
}
