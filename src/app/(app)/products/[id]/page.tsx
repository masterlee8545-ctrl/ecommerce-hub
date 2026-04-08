/**
 * /products/[id] — 상품 상세 + 일반 정보 수정 + 단계 전환
 *
 * 출처: E-1e
 * 헌법: CLAUDE.md §1 P-1 (없으면 notFound), §1 P-3 (estimated 명시),
 *       §1 P-4 (멀티테넌트 — RLS가 차단), §1 P-9 (한국어)
 *
 * 역할:
 * - 상품 단건 + 단계 이력 + 다음 단계 후보 조회
 * - 일반 정보 수정 폼 (ProductForm + updateProductAction)
 * - "다음 단계로 진행" 버튼 (transitionProductStatusAction, 사유 입력 가능)
 * - 자동 생성될 task 미리보기 (TRANSITION_TASK_MAP)
 *
 * 보안:
 * - getProductById가 RLS로 다른 회사 차단 → null이면 notFound()
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Edit3,
  History,
  Inbox,
  Package,
  PlusCircle,
  ReceiptText,
  Sparkles,
  Truck,
  XCircle,
} from 'lucide-react';

import type { Quote } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { transitionProductStatusAction, updateProductAction } from '@/lib/products/actions';
import {
  CONFIDENCE_META,
  NEXT_STAGES,
  PIPELINE_STAGES,
  PIPELINE_STAGE_META,
  TRANSITION_TASK_MAP,
  type ConfidenceLevel,
  type PipelineStage,
} from '@/lib/products/constants';
import { getProductById } from '@/lib/products/queries';
import { listProductStateHistory } from '@/lib/products/transitions';
import { acceptQuoteAction, updateQuoteStatusAction } from '@/lib/sourcing/actions';
import {
  OPEN_QUOTE_STATUSES,
  QUOTE_STATUS_META,
  toPriceWithVat,
  type QuoteStatus,
} from '@/lib/sourcing/constants';
import { listQuotesForProduct } from '@/lib/sourcing/quotes';
import { listSuppliers } from '@/lib/sourcing/suppliers';

import { ProductForm } from '../product-form';

export const dynamic = 'force-dynamic';

const PERCENT_MULTIPLIER = 100;
const MARGIN_DECIMALS = 1;
const KRW_DECIMALS = 0;
const CNY_DECIMALS = 2;
const MAX_SUPPLIER_OPTIONS = 500;
const DEFAULT_VAT_FALLBACK = 0.1;

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireCompanyContext();

  const product = await getProductById(ctx.companyId, id);
  if (!product) notFound();

  // 병렬 조회 — 이력, 견적, 공급사
  const [historyResult, quotesResult, suppliersResult] = await Promise.allSettled([
    listProductStateHistory(ctx.companyId, id),
    listQuotesForProduct({ companyId: ctx.companyId, productId: id }),
    listSuppliers({ companyId: ctx.companyId, limit: MAX_SUPPLIER_OPTIONS }),
  ]);

  const history: Awaited<ReturnType<typeof listProductStateHistory>> =
    historyResult.status === 'fulfilled' ? historyResult.value : [];
  if (historyResult.status === 'rejected') {
    console.error('[products/[id]] 이력 조회 실패:', historyResult.reason);
  }

  const productQuotes: Quote[] =
    quotesResult.status === 'fulfilled' ? quotesResult.value : [];
  if (quotesResult.status === 'rejected') {
    console.error('[products/[id]] 견적 조회 실패:', quotesResult.reason);
  }

  const supplierMap = new Map<string, string>();
  if (suppliersResult.status === 'fulfilled') {
    for (const s of suppliersResult.value) {
      supplierMap.set(s.id, s.name);
    }
  } else {
    console.error('[products/[id]] 공급사 조회 실패:', suppliersResult.reason);
  }

  const currentStage: PipelineStage | null = isPipelineStage(product.status)
    ? product.status
    : null;
  const stageMeta = currentStage ? PIPELINE_STAGE_META[currentStage] : null;
  const allowedNextStages: PipelineStage[] = currentStage ? NEXT_STAGES[currentStage] : [];

  // 수정 폼은 productId를 첫 인자로 받는 액션을 bind로 부분 적용
  const boundUpdateAction = updateProductAction.bind(null, product.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 상단 네비 */}
      <Link
        href="/products"
        className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 hover:text-teal-700"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        상품 목록으로
      </Link>

      {/* 헤더 */}
      <header className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-navy-400">
              <Package className="h-3 w-3" aria-hidden />
              {product.code}
            </div>
            <h1 className="mt-1 truncate text-2xl font-bold text-navy-900">{product.name}</h1>
            {product.category && (
              <p className="mt-1 text-sm text-navy-500">카테고리: {product.category}</p>
            )}
          </div>
          {stageMeta && (
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${stageMeta.bgColor} ${stageMeta.color}`}
              title={stageMeta.description}
            >
              {stageMeta.label}
            </span>
          )}
        </div>

        {/* 가격 정보 카드 */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <PriceTile
            label="원가 (위안)"
            value={
              product.cogs_cny !== null
                ? `¥ ${Number(product.cogs_cny).toFixed(CNY_DECIMALS)}`
                : '미입력'
            }
            confidence={product.cogs_cny_confidence as ConfidenceLevel | null}
          />
          <PriceTile
            label="예상 판매가"
            value={
              product.selling_price_krw !== null
                ? `₩ ${Number(product.selling_price_krw).toLocaleString('ko-KR', {
                    maximumFractionDigits: KRW_DECIMALS,
                  })}`
                : '미입력'
            }
            confidence={null}
          />
          <PriceTile
            label="예상 마진률"
            value={
              product.margin_rate !== null
                ? `${(Number(product.margin_rate) * PERCENT_MULTIPLIER).toFixed(MARGIN_DECIMALS)}%`
                : '미입력'
            }
            confidence={product.margin_rate_confidence as ConfidenceLevel | null}
          />
        </div>

        {product.description && (
          <div className="mt-4 rounded-md bg-navy-50/50 p-3">
            <div className="text-[10px] uppercase font-semibold text-navy-500">설명</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-navy-700">{product.description}</p>
          </div>
        )}
      </header>

      {/* 단계 전환 패널 */}
      {currentStage && allowedNextStages.length > 0 && (
        <TransitionPanel
          productId={product.id}
          fromStage={currentStage}
          nextStages={allowedNextStages}
        />
      )}
      {currentStage && allowedNextStages.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" aria-hidden />이 상품은 마지막 단계({stageMeta?.label})에 도달했습니다.
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            더 이상 진행할 단계가 없습니다. 브랜드 강화는 별도 메뉴에서 관리하세요.
          </p>
        </div>
      )}

      {/* 견적 비교표 */}
      <QuoteComparisonSection
        productId={product.id}
        quotes={productQuotes}
        supplierMap={supplierMap}
        currentStage={currentStage}
      />

      {/* 이력 패널 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-700">
          <History className="h-4 w-4 text-navy-500" aria-hidden />
          단계 변경 이력 ({history.length}건)
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-xs text-navy-500">
            아직 단계 변경 이력이 없습니다. (상품 등록 후 한 번도 진행하지 않음)
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {history.map((h, idx) => (
              <li
                key={`${h.changedAt.toISOString()}-${idx}`}
                className="flex items-center gap-2 rounded-md border border-navy-100 bg-navy-50/30 px-3 py-2 text-xs"
              >
                <Clock className="h-3 w-3 text-navy-400" aria-hidden />
                <span className="font-mono text-navy-500">{formatDateTime(h.changedAt)}</span>
                <span className="text-navy-700">
                  {h.fromStatus ? labelForStage(h.fromStatus) : '(최초)'}
                  <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
                  {labelForStage(h.toStatus)}
                </span>
                {h.reason && (
                  <span className="ml-auto truncate text-navy-500" title={h.reason}>
                    사유: {h.reason}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 일반 정보 수정 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-navy-700">일반 정보 수정</h2>
        <p className="mt-1 text-xs text-navy-500">
          이름, 카테고리, 가격 등은 아래에서 직접 수정할 수 있습니다. 단계 전환은 위의 버튼을 사용하세요.
        </p>
        <div className="mt-4">
          <ProductForm
            action={boundUpdateAction}
            mode="edit"
            defaultValues={{
              name: product.name,
              category: product.category,
              description: product.description,
              cogs_cny: product.cogs_cny,
              cogs_cny_confidence: product.cogs_cny_confidence,
              selling_price_krw: product.selling_price_krw,
              margin_rate: product.margin_rate,
              margin_rate_confidence: product.margin_rate_confidence,
            }}
          />
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 단계 전환 패널 (서버 컴포넌트 — Server Action 직접 사용)
// ─────────────────────────────────────────────────────────

interface TransitionPanelProps {
  productId: string;
  fromStage: PipelineStage;
  nextStages: PipelineStage[];
}

function TransitionPanel({ productId, fromStage, nextStages }: TransitionPanelProps) {
  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-teal-800">
        <Sparkles className="h-4 w-4" aria-hidden />
        다음 단계로 진행
      </h2>
      <p className="mt-1 text-xs text-teal-700">
        다음 단계로 넘어가면 시스템이 자동으로 필요한 작업(task)을 만들어 줍니다.
      </p>

      <div className="mt-4 space-y-3">
        {nextStages.map((toStage) => {
          const toMeta = PIPELINE_STAGE_META[toStage];
          const transitionKey = `${fromStage}:${toStage}`;
          const taskSpecs = TRANSITION_TASK_MAP[transitionKey] ?? [];
          return (
            <form
              key={toStage}
              action={transitionProductStatusAction}
              className="rounded-md border border-teal-200 bg-white p-4"
            >
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="toStatus" value={toStage} />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-navy-500">→</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${toMeta.bgColor} ${toMeta.color}`}
                  >
                    {toMeta.label}
                  </span>
                  <span className="text-xs text-navy-500">{toMeta.description}</span>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700"
                >
                  진행하기
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </button>
              </div>

              {/* 자동 생성될 task 미리보기 */}
              {taskSpecs.length > 0 && (
                <div className="mt-3 rounded-md bg-teal-50/60 p-3">
                  <div className="text-[10px] font-semibold uppercase text-teal-700">
                    자동 생성될 작업 ({taskSpecs.length}개)
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {taskSpecs.map((spec) => (
                      <li
                        key={spec.taskType}
                        className="flex items-center gap-2 text-[11px] text-navy-700"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
                        <span className="font-medium">{spec.title}</span>
                        <span className="text-navy-500">
                          ({spec.priority === 'urgent' || spec.priority === 'high' ? '우선' : '보통'},{' '}
                          {spec.daysUntilDue > 0 ? `D-${spec.daysUntilDue}` : '상시'})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 사유 입력 (선택) */}
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-navy-500 hover:text-teal-700">
                  사유 메모 추가 (선택)
                </summary>
                <textarea
                  name="reason"
                  rows={2}
                  maxLength={500}
                  placeholder="예: 견적 확정, 결제 완료 등"
                  className="mt-2 w-full resize-none rounded-md border border-navy-200 bg-white px-3 py-2 text-xs focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </details>
            </form>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 가격 타일
// ─────────────────────────────────────────────────────────

interface PriceTileProps {
  label: string;
  value: string;
  confidence: ConfidenceLevel | null;
}

function PriceTile({ label, value, confidence }: PriceTileProps) {
  const conf = confidence ?? 'unknown';
  const meta = CONFIDENCE_META[conf];
  return (
    <div className="rounded-md border border-navy-100 bg-navy-50/40 p-3">
      <div className="text-[10px] uppercase font-semibold text-navy-500">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-mono text-base font-semibold text-navy-900">{value}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${meta.color}`}>
          {meta.label}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 견적 비교 섹션 (F-1e)
// ─────────────────────────────────────────────────────────

interface QuoteComparisonSectionProps {
  productId: string;
  quotes: Quote[];
  supplierMap: Map<string, string>;
  currentStage: PipelineStage | null;
}

function QuoteComparisonSection({
  productId,
  quotes,
  supplierMap,
  currentStage,
}: QuoteComparisonSectionProps) {
  // 단가 포함가(VAT 포함) 기준 정렬 — 가장 싼 게 위로. null은 맨 아래.
  const sorted = [...quotes].sort((a, b) => {
    const priceA = computeEffectivePrice(a);
    const priceB = computeEffectivePrice(b);
    if (priceA === null && priceB === null) return 0;
    if (priceA === null) return 1;
    if (priceB === null) return -1;
    return priceA - priceB;
  });

  // 가장 싼(열린) 견적 찾기 — 배지 표시용
  const cheapestOpenId = findCheapestOpenQuoteId(sorted);

  // accept 버튼을 허용하는 단계: 'sourcing'에서만 (다른 단계에서는 의미 없음)
  const canAccept = currentStage === 'sourcing';

  return (
    <section className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-700">
          <ReceiptText className="h-4 w-4 text-navy-500" aria-hidden />
          견적 비교 ({quotes.length}건)
        </h2>
        <Link
          href={`/sourcing/quotes/new?productId=${productId}`}
          className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
        >
          <PlusCircle className="h-3 w-3" aria-hidden />
          견적 등록
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-navy-200 bg-navy-50/30 p-4 text-center">
          <p className="text-xs text-navy-500">
            아직 등록된 견적이 없습니다. 수입 대행업체에게 받은 견적서를 등록해 비교하세요.
          </p>
          <Link
            href={`/sourcing/quotes/new?productId=${productId}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            <PlusCircle className="h-3 w-3" aria-hidden />첫 견적 등록하기
          </Link>
        </div>
      ) : (
        <>
          {!canAccept && currentStage !== null && (
            <p className="mt-3 rounded-md bg-navy-50 px-3 py-2 text-[11px] text-navy-500">
              💡 이 상품은 현재 <strong>{PIPELINE_STAGE_META[currentStage].label}</strong>{' '}
              단계입니다. 견적 확정(발주)은 <strong>소싱</strong> 단계에서만 가능합니다.
            </p>
          )}
          <ol className="mt-3 space-y-2">
            {sorted.map((q) => (
              <QuoteRow
                key={q.id}
                quote={q}
                productId={productId}
                supplierName={q.supplier_id ? supplierMap.get(q.supplier_id) ?? null : null}
                isCheapest={q.id === cheapestOpenId}
                canAccept={canAccept}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 견적 행 (단일 견적 표시 + 발주 버튼)
// ─────────────────────────────────────────────────────────

interface QuoteRowProps {
  quote: Quote;
  productId: string;
  supplierName: string | null;
  isCheapest: boolean;
  canAccept: boolean;
}

function QuoteRow({ quote, productId, supplierName, isCheapest, canAccept }: QuoteRowProps) {
  const status = quote.status as QuoteStatus;
  const meta = QUOTE_STATUS_META[status];
  const isOpen = (OPEN_QUOTE_STATUSES as readonly string[]).includes(status);

  const effective = computeEffectivePrice(quote);

  return (
    <li
      className={`rounded-md border p-3 ${
        isCheapest && isOpen
          ? 'border-emerald-300 bg-emerald-50/40'
          : 'border-navy-100 bg-navy-50/20'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* 왼쪽: 공급사 + 상태 + 배지 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-navy-400" aria-hidden />
            <span className="truncate text-sm font-semibold text-navy-900">
              {supplierName ?? '(공급사 미지정)'}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.bgColor} ${meta.color}`}
              title={meta.description}
            >
              {meta.label}
            </span>
            {isCheapest && isOpen && (
              <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                최저가
              </span>
            )}
          </div>

          {/* 단가 + VAT 정보 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-700">
            <span className="inline-flex items-center gap-1">
              <CircleDollarSign className="h-3 w-3 text-navy-400" aria-hidden />
              <span className="font-mono">
                {quote.unit_price_krw !== null
                  ? `₩ ${formatKrw(Number(quote.unit_price_krw))}`
                  : '—'}
              </span>
              <span className="text-[10px] text-navy-500">
                {quote.vat_included ? '(VAT 포함)' : '(VAT 별도)'}
              </span>
            </span>
            {effective !== null && !quote.vat_included && (
              <span className="text-[10px] text-navy-500">
                → VAT 포함가: ₩{formatKrw(effective)}
              </span>
            )}
            {quote.moq !== null && (
              <span className="inline-flex items-center gap-1">
                <Package className="h-3 w-3 text-navy-400" aria-hidden />
                MOQ {quote.moq.toLocaleString('ko-KR')}개
              </span>
            )}
            {quote.lead_time_days !== null && (
              <span className="inline-flex items-center gap-1">
                <Truck className="h-3 w-3 text-navy-400" aria-hidden />
                D-{quote.lead_time_days}
              </span>
            )}
          </div>

          {quote.payment_terms && (
            <p className="mt-1 text-[11px] text-navy-500">결제조건: {quote.payment_terms}</p>
          )}
          {quote.notes && (
            <p className="mt-0.5 truncate text-[11px] text-navy-500" title={quote.notes}>
              메모: {quote.notes}
            </p>
          )}
        </div>

        {/* 오른쪽: 상태 전환 / 발주 / 수정 버튼 */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* 요청 단계 — "수신됨" 전환 (G-3a) */}
          {status === 'requested' && (
            <form action={updateQuoteStatusAction}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="status" value="received" />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100"
                title="공급사에서 견적서를 받았음을 표시합니다 (수신일이 지금으로 기록됩니다)."
              >
                <Inbox className="h-3 w-3" aria-hidden />
                수신됨
              </button>
            </form>
          )}

          {/* 확정 (accept) — received 단계에서만, 그리고 소싱 단계 상품에서만 */}
          {isOpen && canAccept && (
            <form action={acceptQuoteAction}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700"
                title="이 견적으로 발주를 확정합니다. 다른 견적은 자동 거절되고 상품이 수입 단계로 넘어갑니다."
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden />이 견적으로 발주
              </button>
            </form>
          )}

          {/* 거절 — requested/received 단계에서만 (G-3a) */}
          {(status === 'requested' || status === 'received') && (
            <form action={updateQuoteStatusAction}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="status" value="rejected" />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-500 transition hover:border-red-300 hover:text-red-600"
                title="이 견적을 거절합니다 (조건 불일치, 공급사 응답 없음 등)."
              >
                <XCircle className="h-3 w-3" aria-hidden />
                거절
              </button>
            </form>
          )}

          <Link
            href={`/sourcing/quotes/${quote.id}/edit`}
            className="inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-600 transition hover:border-teal-300 hover:text-teal-700"
            aria-label="이 견적 수정"
          >
            <Edit3 className="h-3 w-3" aria-hidden />
            수정
          </Link>
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 견적 보조 함수
// ─────────────────────────────────────────────────────────

/**
 * VAT 포함 최종 단가를 계산. unit_price_krw가 없으면 null.
 */
function computeEffectivePrice(quote: Quote): number | null {
  if (quote.unit_price_krw === null) return null;
  const price = Number(quote.unit_price_krw);
  if (!Number.isFinite(price)) return null;
  const vatRate =
    quote.vat_rate !== null && Number.isFinite(Number(quote.vat_rate))
      ? Number(quote.vat_rate)
      : DEFAULT_VAT_FALLBACK;
  return toPriceWithVat(price, vatRate, quote.vat_included);
}

/** 가장 싼 열린 견적의 id. 없으면 null. */
function findCheapestOpenQuoteId(sortedQuotes: Quote[]): string | null {
  for (const q of sortedQuotes) {
    if ((OPEN_QUOTE_STATUSES as readonly string[]).includes(q.status)) {
      if (q.unit_price_krw !== null) return q.id;
    }
  }
  return null;
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: KRW_DECIMALS });
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

function labelForStage(stage: string): string {
  return isPipelineStage(stage) ? PIPELINE_STAGE_META[stage].label : stage;
}

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
