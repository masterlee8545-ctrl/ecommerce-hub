/**
 * /active — 런칭 / 마케팅 (Step 5 — 최종 단계)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - active 단계 상품 목록 (런칭 완료 + 마케팅 진행중)
 * - 각 상품별 마케팅 체크리스트 (로켓 입점, 리뷰, 블로그, 바이럴)
 * - 작업 상태 변경 인라인 버튼
 * - 직원에게 배정된 마케팅 작업 관리
 */
import Link from 'next/link';

import {
  CheckCircle2,
  Clock,
  ExternalLink,
  ListChecks,
  Package,
  Play,
  Rocket,
} from 'lucide-react';

import type { Product, Task } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
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

// 마케팅 체크리스트 항목 (작업이 없는 경우 시각적 가이드)
const MARKETING_CHECKLIST = [
  { label: '로켓 입점 신청', description: '쿠팡 로켓배송 입점' },
  { label: '리뷰 작업', description: '초기 리뷰 확보 전략' },
  { label: '블로그 포스팅', description: '네이버 블로그 콘텐츠' },
  { label: '바이럴 마케팅', description: 'SNS 및 커뮤니티 홍보' },
];

export default async function ActivePage() {
  const ctx = await requireCompanyContext();

  let activeProducts: Product[] = [];
  let dbError: string | null = null;
  try {
    activeProducts = await listProducts({
      companyId: ctx.companyId,
      stages: ['active'],
      limit: LIST_LIMIT,
    });
  } catch (err) {
    console.error('[active] 상품 조회 실패:', err);
    dbError = err instanceof Error ? err.message : '상품을 불러올 수 없습니다.';
  }

  // 상품별 작업 조회
  const productIds = activeProducts.map((p) => p.id);
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
    console.error('[active] 작업 조회 실패:', err);
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
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-600">
          <Rocket className="h-4 w-4" aria-hidden />
          Step 5
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">런칭 / 마케팅</h1>
        <p className="mt-1 text-sm text-navy-500">
          로켓 입점, 리뷰 작업, 블로그 포스팅, 바이럴 마케팅을 관리합니다.
          직원에게 작업을 배정하고 진행률을 추적합니다.
        </p>
      </header>

      {/* 본문 */}
      {dbError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
          <div className="font-semibold text-amber-900">데이터를 불러올 수 없습니다</div>
          <p className="mt-1 text-xs">{dbError}</p>
        </div>
      ) : activeProducts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
          <Rocket className="mx-auto h-10 w-10 text-navy-300" />
          <h3 className="mt-3 text-base font-semibold text-navy-700">
            런칭된 상품이 없습니다
          </h3>
          <p className="mt-1 text-xs text-navy-500">
            상세페이지/등록이 완료된 상품이 이 단계로 넘어옵니다.
          </p>
          <Link
            href="/listing"
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-800"
          >
            등록 화면 보기 →
          </Link>
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
              런칭 상품 ({activeProducts.length}개)
            </h2>
            <Link
              href="/products?stage=active"
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              전체 목록 →
            </Link>
          </div>
          <ul className="space-y-3">
            {activeProducts.map((product) => (
              <ActiveCard
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
// 런칭 상품 카드
// ─────────────────────────────────────────────────────────

interface ActiveCardProps {
  product: Product;
  tasks: Task[];
}

function ActiveCard({ product, tasks }: ActiveCardProps) {
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
  const activeTotal = total - cancelledCount;
  const progressPercent = activeTotal > 0 ? Math.round((doneCount / activeTotal) * PERCENT_MAX) : 0;
  const allDone = activeTotal > 0 && doneCount === activeTotal;

  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  // description에서 소스 URL 추출
  const lines = (product.description ?? '').split('\n');
  const sourceLine = lines.find((l) => l.startsWith('소스: '));
  const sourceUrl = sourceLine ? sourceLine.replace('소스: ', '').trim() : null;

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-4">
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
            {allDone && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                마케팅 완료
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-navy-500">
            {product.selling_price_krw !== null && (
              <span>₩{Number(product.selling_price_krw).toLocaleString('ko-KR')}</span>
            )}
            {product.margin_rate !== null && (
              <span className="rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700">
                마진 {(Number(product.margin_rate) * PERCENT_MAX).toFixed(1)}%
              </span>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
              >
                <ExternalLink className="h-3 w-3" />
                소스
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 작업 진행률 */}
      {activeTotal > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 font-semibold text-navy-600">
              <ListChecks className="h-3 w-3" aria-hidden />
              마케팅 진행률
            </span>
            <span className="font-mono text-navy-500">
              {doneCount}/{activeTotal}
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
              className={`h-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-teal-500'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* 작업 목록 or 체크리스트 가이드 */}
      {openTasks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {openTasks.map((t) => {
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
        </ul>
      ) : total === 0 ? (
        /* 작업이 아직 없는 경우 — 마케팅 체크리스트 가이드 */
        <div className="mt-3 rounded-md border border-dashed border-navy-200 bg-navy-50/20 p-3">
          <p className="text-[11px] font-semibold text-navy-600">마케팅 체크리스트 (가이드)</p>
          <ul className="mt-1.5 space-y-1">
            {MARKETING_CHECKLIST.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-[11px] text-navy-500">
                <Package className="h-3 w-3 shrink-0 text-navy-300" aria-hidden />
                <span className="font-medium">{item.label}</span>
                <span className="text-navy-400">— {item.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-navy-400">
            작업 관리에서 마케팅 작업을 수동 등록하거나, 단계 전환 시 자동 생성됩니다.
          </p>
        </div>
      ) : null}
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
