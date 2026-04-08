/**
 * /importing — 수입 단계 대시보드 (G-1)
 *
 * 출처: docs/SPEC.md §3 Importing 단계, G 단계 첫 작업
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-2 (DB 실패 시 사용자 친화 에러),
 *       §1 P-4 (멀티테넌트 RLS), §1 P-9 (한국어 UX)
 *
 * 역할:
 * - 현재 "수입(importing) 단계"에 있는 상품들의 진행 상황 한눈에
 * - 각 상품별로 ①확정된 견적(공급사/단가/MOQ/납기), ②자동 생성된 작업 진행률,
 *   ③오픈된 작업 요약 표시
 * - 상세 → /products/[id] 로 진입
 * - 모든 작업이 완료되면 "등록 단계로 진행" 안내 (실제 전환은 상품 상세에서)
 *
 * 데이터 흐름 (N+1 방지):
 * 1. requireCompanyContext()
 * 2. 병렬 조회:
 *    - listProducts({ stages: ['importing'] })           — 대시보드 상품 집합
 *    - listQuotesWithRelations({ statuses: ['accepted'] }) — accepted 견적 + 공급사
 *    - listTasksForProducts({ productIds, openOnly: false }) — 상품별 작업 전량
 * 3. 메모리에서 productId로 매칭 후 카드 렌더
 *
 * 보안 (P-4):
 * - 모든 쿼리가 withCompanyContext 내부에서 실행 → 다른 회사 데이터 0% 노출
 */
import Link from 'next/link';

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  ListChecks,
  Play,
  Package,
  PackageSearch,
  ReceiptText,
  Sparkles,
  Truck,
} from 'lucide-react';

import type { Product, Task } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import {
  LEAD_TIME_SORT_ORDER,
  computeLeadTimeStatus,
  type LeadTimeEvaluation,
} from '@/lib/importing/lead-time';
import { listProducts } from '@/lib/products/queries';
import { toPriceWithVat } from '@/lib/sourcing/constants';
import {
  listQuotesWithRelations,
  type QuoteWithRelations,
} from '@/lib/sourcing/quotes';
import { updateTaskStatusAction } from '@/lib/tasks/actions';
import {
  listTasksForProducts,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/queries';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const IMPORTING_LIMIT = 100;
const ACCEPTED_QUOTES_LIMIT = 500;
const KRW_DECIMALS = 0;
const DEFAULT_VAT_FALLBACK = 0.1;
const PERCENT_MAX = 100;
const MAX_TASK_PREVIEW = 3;

// 작업 상태별 표시 메타
const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; bgColor: string }
> = {
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

/**
 * 각 상태에서 "다음 단계 원클릭 전환" 대상.
 * - pending → in_progress (시작)
 * - in_progress → done (완료)
 * - review → done (완료)
 * - done / cancelled → null (버튼 숨김)
 */
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

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function ImportingPage() {
  const ctx = await requireCompanyContext();

  // 1) 수입 중 상품을 먼저 가져와야 이후 productIds가 확정됨
  let importingProducts: Product[] = [];
  let dbError: string | null = null;
  try {
    importingProducts = await listProducts({
      companyId: ctx.companyId,
      stages: ['importing'],
      limit: IMPORTING_LIMIT,
    });
  } catch (err) {
    console.error('[importing] listProducts 실패:', err);
    dbError =
      err instanceof Error
        ? `수입 단계 상품 목록 조회 중 오류: ${err.message}`
        : '수입 단계 상품 목록을 불러올 수 없습니다.';
  }

  // 빈 목록이면 견적/작업 쿼리를 생략 (쓸데없는 DB 왕복 방지)
  const productIds = importingProducts.map((p) => p.id);

  const [acceptedRelationsResult, productTasksResult] = await Promise.allSettled([
    productIds.length > 0
      ? listQuotesWithRelations({
          companyId: ctx.companyId,
          statuses: ['accepted'],
          limit: ACCEPTED_QUOTES_LIMIT,
        })
      : Promise.resolve<QuoteWithRelations[]>([]),
    productIds.length > 0
      ? listTasksForProducts({
          companyId: ctx.companyId,
          productIds,
          openOnly: false,
        })
      : Promise.resolve<Task[]>([]),
  ]);

  const acceptedRelations: QuoteWithRelations[] =
    acceptedRelationsResult.status === 'fulfilled' ? acceptedRelationsResult.value : [];
  if (acceptedRelationsResult.status === 'rejected') {
    console.error('[importing] 확정 견적 조회 실패:', acceptedRelationsResult.reason);
  }

  const productTasks: Task[] =
    productTasksResult.status === 'fulfilled' ? productTasksResult.value : [];
  if (productTasksResult.status === 'rejected') {
    console.error('[importing] 작업 조회 실패:', productTasksResult.reason);
  }

  // productId → 확정된 견적 매핑 (상품 ↔ 견적은 1:1 — 다른 건 acceptQuote가 자동 거절)
  const acceptedByProductId = new Map<string, QuoteWithRelations>();
  for (const rel of acceptedRelations) {
    const pid = rel.quote.product_id;
    if (pid) acceptedByProductId.set(pid, rel);
  }

  // productId → 작업 배열 (마감 빠른 순은 listTasksForProducts가 이미 보장)
  const tasksByProductId = new Map<string, Task[]>();
  for (const t of productTasks) {
    const pid = t.product_id;
    if (!pid) continue;
    const arr = tasksByProductId.get(pid) ?? [];
    arr.push(t);
    tasksByProductId.set(pid, arr);
  }

  // 리드타임 평가를 한 번만 계산해서 정렬 + 카드에 재사용 (G-3c)
  // — 같은 시각으로 평가해야 카드 간 일관성이 보장됨 (now를 한 번 캡처)
  const evaluatedAt = new Date();
  const evaluatedProducts = importingProducts.map((product) => {
    const acceptedRelation = acceptedByProductId.get(product.id) ?? null;
    const leadTimeEval = computeLeadTimeStatus(
      {
        decidedAt: acceptedRelation?.quote.decided_at ?? null,
        leadTimeDays: acceptedRelation?.quote.lead_time_days ?? null,
      },
      evaluatedAt,
    );
    return { product, acceptedRelation, leadTimeEval };
  });

  // 정렬: overdue → soon → ok → unknown.
  // 같은 그룹 안에서는 overdue는 더 많이 지연된 것이 위로.
  evaluatedProducts.sort((a, b) => {
    const orderDiff =
      LEAD_TIME_SORT_ORDER[a.leadTimeEval.status] -
      LEAD_TIME_SORT_ORDER[b.leadTimeEval.status];
    if (orderDiff !== 0) return orderDiff;
    if (a.leadTimeEval.status === 'overdue') {
      return (b.leadTimeEval.daysOverdue ?? 0) - (a.leadTimeEval.daysOverdue ?? 0);
    }
    return 0;
  });

  // 요약 카운트 (배너용)
  const overdueCount = evaluatedProducts.filter(
    (p) => p.leadTimeEval.status === 'overdue',
  ).length;
  const soonCount = evaluatedProducts.filter(
    (p) => p.leadTimeEval.status === 'soon',
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-purple-700">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-50 text-[10px] font-bold">
            3
          </span>
          파이프라인 3단계
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">수입</h1>
            <p className="mt-1 text-sm text-navy-500">
              견적이 확정된 상품의 발주·결제·통관·입고 진행 상황을 한 곳에서 추적합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sourcing/quotes?status=accepted"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <ReceiptText className="h-3.5 w-3.5" aria-hidden />
              확정 견적 목록
            </Link>
            <Link
              href="/products?stage=importing"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <Package className="h-3.5 w-3.5" aria-hidden />
              상품으로 보기
            </Link>
          </div>
        </div>
      </header>

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : evaluatedProducts.length === 0 ? (
        <EmptyPanel />
      ) : (
        <>
          {/* 납기 경고 배너 — 지연 / 임박이 1건 이상이면 표시 */}
          {(overdueCount > 0 || soonCount > 0) && (
            <LeadTimeWarningBanner overdueCount={overdueCount} soonCount={soonCount} />
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
                수입 중인 상품 ({evaluatedProducts.length}건)
              </h2>
              <span className="text-[11px] text-navy-400">
                지연·임박 우선 정렬 · 최대 {IMPORTING_LIMIT}건
              </span>
            </div>

            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {evaluatedProducts.map(({ product, acceptedRelation, leadTimeEval }) => (
                <ImportingCard
                  key={product.id}
                  product={product}
                  acceptedRelation={acceptedRelation}
                  tasks={tasksByProductId.get(product.id) ?? []}
                  leadTimeEval={leadTimeEval}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 납기 경고 배너 (G-3c)
// ─────────────────────────────────────────────────────────

interface LeadTimeWarningBannerProps {
  overdueCount: number;
  soonCount: number;
}

function LeadTimeWarningBanner({ overdueCount, soonCount }: LeadTimeWarningBannerProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        납기 주의
      </div>
      <p className="mt-1 text-amber-800">
        {overdueCount > 0 && (
          <span className="font-semibold text-red-700">지연 {overdueCount}건</span>
        )}
        {overdueCount > 0 && soonCount > 0 && <span className="mx-1">·</span>}
        {soonCount > 0 && <span>곧 납기 도래 {soonCount}건</span>}
        {' '}이 있습니다. 카드 위쪽부터 확인해 공급사에 진행 상황을 문의하세요.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────

interface ImportingCardProps {
  product: Product;
  acceptedRelation: QuoteWithRelations | null;
  tasks: Task[];
  leadTimeEval: LeadTimeEvaluation;
}

function ImportingCard({
  product,
  acceptedRelation,
  tasks,
  leadTimeEval,
}: ImportingCardProps) {
  const quote = acceptedRelation?.quote ?? null;
  const supplierName = acceptedRelation?.supplier?.name ?? null;

  // 작업 진행률
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
  const activeTotal = total - cancelledCount;
  const progressPercent =
    activeTotal > 0 ? Math.round((doneCount / activeTotal) * PERCENT_MAX) : 0;
  const allDone = activeTotal > 0 && doneCount === activeTotal;

  // 오픈 작업(아직 미완료) 미리보기
  const openTasks = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled',
  );
  const previewTasks = openTasks.slice(0, MAX_TASK_PREVIEW);
  const hiddenTaskCount = Math.max(0, openTasks.length - MAX_TASK_PREVIEW);

  // VAT 포함 실효가
  const effectivePrice = computeEffectivePrice(quote);

  // 카드 테두리 색상 — 지연/임박일 때 시각적으로 강조
  const cardBorderClass =
    leadTimeEval.status === 'overdue'
      ? 'border-red-300 bg-red-50/20'
      : leadTimeEval.status === 'soon'
        ? 'border-amber-300 bg-amber-50/20'
        : 'border-navy-200 bg-white';

  return (
    <li className={`rounded-lg border p-4 shadow-sm ${cardBorderClass}`}>
      {/* 상단: 상품명 + 코드 + 단계/지연 배지 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono text-navy-400">
            <Package className="h-3 w-3" aria-hidden />
            {product.code}
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-navy-900">
            {product.name}
          </h3>
          {product.category && (
            <p className="mt-0.5 text-[11px] text-navy-500">{product.category}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
            수입
          </span>
          {leadTimeEval.status === 'overdue' && leadTimeEval.daysOverdue !== null && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700"
              title={`견적 확정 후 ${leadTimeEval.daysElapsed}일 경과 (리드타임 초과 ${leadTimeEval.daysOverdue}일)`}
            >
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
              지연 D+{leadTimeEval.daysOverdue}
            </span>
          )}
          {leadTimeEval.status === 'soon' && leadTimeEval.daysRemaining !== null && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
              title={`견적 확정 후 ${leadTimeEval.daysElapsed}일 경과 (남은 ${leadTimeEval.daysRemaining}일)`}
            >
              <Clock className="h-2.5 w-2.5" aria-hidden />
              곧 납기 D-{leadTimeEval.daysRemaining}
            </span>
          )}
        </div>
      </div>

      {/* 확정된 견적 정보 */}
      <div className="mt-3 rounded-md border border-navy-100 bg-navy-50/40 p-3">
        {quote ? (
          <>
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-navy-500">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden />
              확정된 견적
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-700">
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3 text-navy-400" aria-hidden />
                <span className="font-semibold">{supplierName ?? '(공급사 미지정)'}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <CircleDollarSign className="h-3 w-3 text-navy-400" aria-hidden />
                <span className="font-mono">
                  {effectivePrice !== null
                    ? `₩${formatKrw(effectivePrice)}`
                    : quote.unit_price_krw !== null
                      ? `₩${formatKrw(Number(quote.unit_price_krw))}`
                      : '—'}
                </span>
                <span className="text-[10px] text-navy-500">
                  {quote.vat_included ? '(VAT포함)' : '(VAT포함가)'}
                </span>
              </span>
              {quote.moq !== null && (
                <span className="inline-flex items-center gap-1">
                  <Package className="h-3 w-3 text-navy-400" aria-hidden />
                  MOQ {quote.moq.toLocaleString('ko-KR')}개
                </span>
              )}
              {quote.lead_time_days !== null && (
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-3 w-3 text-navy-400" aria-hidden />
                  납기 D-{quote.lead_time_days}
                </span>
              )}
            </div>
            {quote.payment_terms && (
              <p className="mt-1 text-[11px] text-navy-500">결제조건: {quote.payment_terms}</p>
            )}
          </>
        ) : (
          <div className="text-[11px] text-amber-700">
            ⚠ 확정된 견적 정보를 찾을 수 없습니다. (수동 상태 변경 또는 견적 삭제)
          </div>
        )}
      </div>

      {/* 작업 진행률 */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-navy-600">
          <span className="inline-flex items-center gap-1 font-semibold">
            <ListChecks className="h-3 w-3 text-navy-500" aria-hidden />
            작업 진행률
          </span>
          <span className="font-mono text-navy-500">
            {doneCount} / {activeTotal}
            {cancelledCount > 0 && (
              <span className="ml-1 text-navy-400">(취소 {cancelledCount})</span>
            )}
          </span>
        </div>
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-navy-100"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={PERCENT_MAX}
          aria-label={`작업 진행률 ${progressPercent}%`}
        >
          <div
            className={`h-full transition-all ${
              allDone ? 'bg-emerald-500' : 'bg-teal-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* 오픈 작업 미리보기 — 인라인 상태 전환 버튼 포함 */}
        {previewTasks.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {previewTasks.map((t) => {
              const status = t.status as TaskStatus;
              const priority = t.priority as TaskPriority;
              const statusMeta = TASK_STATUS_META[status];
              const priorityMeta = PRIORITY_META[priority];
              const nextAction = NEXT_STATUS_ACTION[status];
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-[11px] text-navy-700"
                >
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${statusMeta.bgColor} ${statusMeta.color}`}
                  >
                    {statusMeta.label}
                  </span>
                  <span className="truncate">{t.title}</span>
                  {(priority === 'urgent' || priority === 'high') && (
                    <span className={`shrink-0 text-[9px] font-semibold ${priorityMeta.color}`}>
                      [{priorityMeta.label}]
                    </span>
                  )}
                  {t.due_at && (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-navy-400">
                      <Clock className="h-2.5 w-2.5" aria-hidden />
                      {formatShortDate(t.due_at)}
                    </span>
                  )}
                  {nextAction && (
                    <form
                      action={updateTaskStatusAction}
                      className={t.due_at ? '' : 'ml-auto'}
                    >
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="status" value={nextAction.nextStatus} />
                      <button
                        type="submit"
                        className="inline-flex shrink-0 items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[9px] font-semibold text-teal-700 transition hover:border-teal-400 hover:bg-teal-100"
                        aria-label={`작업 "${t.title}" ${nextAction.label}`}
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
            {hiddenTaskCount > 0 && (
              <li className="text-[10px] text-navy-400">+ {hiddenTaskCount}개 더 보기</li>
            )}
          </ul>
        ) : total === 0 ? (
          <p className="mt-2 text-[11px] text-navy-400">
            자동 생성된 작업이 없습니다. (수동으로 단계 변경된 상품)
          </p>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            모든 작업이 완료되었습니다 — 등록 단계로 진행할 수 있습니다.
          </p>
        )}
      </div>

      {/* 하단: 액션 */}
      <div className="mt-3 flex items-center justify-between border-t border-navy-100 pt-3">
        <Link
          href="/tasks"
          className="text-[11px] text-navy-500 transition hover:text-teal-700"
        >
          작업 관리 &rarr;
        </Link>
        <Link
          href={`/products/${product.id}`}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            allDone
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'border border-navy-200 bg-white text-navy-700 hover:border-teal-300 hover:text-teal-700'
          }`}
        >
          {allDone ? (
            <>
              <Sparkles className="h-3 w-3" aria-hidden />
              등록 단계로
            </>
          ) : (
            <>
              상세 보기
              <ArrowRight className="h-3 w-3" aria-hidden />
            </>
          )}
        </Link>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <PackageSearch className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">
        아직 수입 중인 상품이 없습니다
      </h2>
      <p className="mt-1 text-xs text-navy-500">
        소싱 단계에서 견적을 확정(&ldquo;이 견적으로 발주&rdquo;)하면 상품이 자동으로 수입
        단계로 넘어옵니다.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Link
          href="/sourcing/quotes"
          className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          <ReceiptText className="h-4 w-4" aria-hidden />
          견적 목록으로
        </Link>
        <Link
          href="/products?stage=sourcing"
          className="inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
        >
          <Package className="h-4 w-4" aria-hidden />
          소싱 중 상품 보기
        </Link>
      </div>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">수입 대시보드를 불러올 수 없습니다</div>
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

/** VAT 포함 최종 단가 계산 — unit_price_krw 없으면 null */
function computeEffectivePrice(
  quote: QuoteWithRelations['quote'] | null,
): number | null {
  if (!quote || quote.unit_price_krw === null) return null;
  const price = Number(quote.unit_price_krw);
  if (!Number.isFinite(price)) return null;
  const vatRate =
    quote.vat_rate !== null && Number.isFinite(Number(quote.vat_rate))
      ? Number(quote.vat_rate)
      : DEFAULT_VAT_FALLBACK;
  return toPriceWithVat(price, vatRate, quote.vat_included);
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: KRW_DECIMALS });
}

function formatShortDate(date: Date): string {
  try {
    return date.toLocaleDateString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(date);
  }
}
