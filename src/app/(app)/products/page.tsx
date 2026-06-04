/**
 * /products — 상품 파이프라인 목록 (전체 5단계)
 *
 * 출처: docs/SPEC.md §3 (5단계 파이프라인), E-1c
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-3 (estimated 마킹),
 *       §1 P-4 (멀티테넌트 RLS), §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 회사의 모든 상품을 단계별로 표시
 * - 단계 필터 칩 (전체 / research / sourcing / ... / active)
 * - 각 카드: 코드, 이름, 단계 배지, 카테고리, 원가/마진 + 신뢰도, 등록일
 * - 코드/이름 클릭 → /products/[id] 상세
 *
 * URL 쿼리:
 * - ?stage=research,sourcing → 해당 단계만 필터링
 * - 필터 없으면 전체 표시
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 인증 + 회사 컨텍스트
 * 2. countProductsByStage(companyId) — 칩 옆 숫자
 * 3. listProducts({ companyId, stages, limit }) — RLS 자동 적용
 */
import Link from 'next/link';

import { sql } from 'drizzle-orm';
import { ArrowRight, Package, Plus, Tag, User } from 'lucide-react';

import { withCompanyContext } from '@/db';
import { products } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import {
  CONFIDENCE_META,
  PIPELINE_STAGES,
  PIPELINE_STAGE_META,
  type ConfidenceLevel,
  type PipelineStage,
} from '@/lib/products/constants';
import {
  countProductsByStage,
  listProducts,
  parsePipelineStageFilter,
} from '@/lib/products/queries';

export const dynamic = 'force-dynamic';

const PRODUCTS_LIMIT = 100;
const PERCENT_MULTIPLIER = 100;
const KRW_DECIMALS = 0;
const CNY_DECIMALS = 2;

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ stage?: string; supply?: string }>;
}

type SupplyFilter = 'domestic_vendor' | 'overseas_supplier' | undefined;

function parseSupplyFilter(v: string | undefined): SupplyFilter {
  if (v === 'domestic_vendor' || v === 'overseas_supplier') return v;
  return undefined;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const ctx = await requireCompanyContext();
  const sp = await searchParams;
  const stages = parsePipelineStageFilter(sp.stage);
  const supplyFilter = parseSupplyFilter(sp.supply);

  // DB 조회 — 실패 시 빈 배열로 폴백
  let rows: Awaited<ReturnType<typeof listProducts>> = [];
  let counts: Record<PipelineStage, number> | null = null;
  const supplyCounts: { domestic: number; overseas: number; none: number } = {
    domestic: 0,
    overseas: 0,
    none: 0,
  };
  let dbError: string | null = null;
  try {
    const listArgs: Parameters<typeof listProducts>[0] = {
      companyId: ctx.companyId,
      stages,
      limit: PRODUCTS_LIMIT,
    };
    if (supplyFilter) listArgs.supplyType = supplyFilter;
    // operator 는 자기에게 배정된 상품만 표시
    if (ctx.role === 'operator') {
      listArgs.assigneeUserId = ctx.userId;
    }
    [rows, counts] = await Promise.all([
      listProducts(listArgs),
      countProductsByStage(ctx.companyId),
    ]);
    // supply_type 별 카운트
    const supplyCountRows = await withCompanyContext(ctx.companyId, async (tx) =>
      tx
        .select({
          supply_type: products.supply_type,
          n: sql<number>`count(*)::int`,
        })
        .from(products)
        .where(sql`${products.company_id} = ${ctx.companyId}`)
        .groupBy(products.supply_type),
    );
    for (const r of supplyCountRows) {
      if (r.supply_type === 'domestic_vendor') supplyCounts.domestic = r.n;
      else if (r.supply_type === 'overseas_supplier') supplyCounts.overseas = r.n;
      else supplyCounts.none += r.n;
    }
  } catch (err) {
    console.error('[products] 조회 실패:', err);
    dbError =
      err instanceof Error
        ? `상품 목록 조회 중 오류: ${err.message}`
        : '상품 목록을 불러올 수 없습니다.';
  }

  const totalCount = counts
    ? (Object.values(counts) as number[]).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
          <Package className="h-4 w-4" aria-hidden />
          상품 파이프라인
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">상품 관리</h1>
            <p className="mt-1 text-sm text-navy-500">
              회사의 모든 상품을 6단계 파이프라인으로 추적합니다.
              리서치 → 소싱 → 수입 → 등록 → 판매 → 브랜딩.
            </p>
          </div>
          <Link
            href="/products/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            상품 등록
          </Link>
        </div>
      </header>

      {/* 카테고리 탭 (공산품 / 농수산물) */}
      <SupplyTabs
        activeSupply={supplyFilter}
        supplyCounts={supplyCounts}
        totalCount={totalCount}
        currentStage={stages[0]}
      />

      {/* 단계 필터 칩 */}
      {counts && (
        <StageFilterChips
          activeStages={stages}
          counts={counts}
          totalCount={totalCount}
          currentSupply={supplyFilter}
        />
      )}

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel hasFilter={stages.length > 0} />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
              {stages.length > 0
                ? `필터된 상품 (${rows.length}개)`
                : `등록된 상품 (${rows.length}개)`}
            </h2>
            <span className="text-[11px] text-navy-400">
              최신 등록순 · 최대 {PRODUCTS_LIMIT}개
            </span>
          </div>

          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rows.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 단계 필터 칩
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 카테고리 탭 (공산품 / 농수산물)
// ─────────────────────────────────────────────────────────

interface SupplyTabsProps {
  activeSupply: SupplyFilter;
  supplyCounts: { domestic: number; overseas: number; none: number };
  totalCount: number;
  currentStage: PipelineStage | undefined;
}

function buildHref(stage: PipelineStage | undefined, supply: SupplyFilter): string {
  const params = new URLSearchParams();
  if (stage) params.set('stage', stage);
  if (supply) params.set('supply', supply);
  const qs = params.toString();
  return qs ? `/products?${qs}` : '/products';
}

function SupplyTabs({ activeSupply, supplyCounts, totalCount, currentStage }: SupplyTabsProps) {
  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-navy-200 pb-2" aria-label="카테고리">
      <Link
        href={buildHref(currentStage, undefined)}
        className={`inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-4 py-2 text-sm font-semibold transition ${
          !activeSupply
            ? 'border-teal-600 text-teal-700'
            : 'border-transparent text-navy-500 hover:text-teal-700'
        }`}
      >
        🗂 전체
        <span className="rounded-full bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-700">
          {totalCount}
        </span>
      </Link>
      <Link
        href={buildHref(currentStage, 'overseas_supplier')}
        className={`inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-4 py-2 text-sm font-semibold transition ${
          activeSupply === 'overseas_supplier'
            ? 'border-blue-600 text-blue-700'
            : 'border-transparent text-navy-500 hover:text-blue-700'
        }`}
      >
        🏭 공산품
        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono text-blue-700">
          {supplyCounts.overseas}
        </span>
      </Link>
      <Link
        href={buildHref(currentStage, 'domestic_vendor')}
        className={`inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-4 py-2 text-sm font-semibold transition ${
          activeSupply === 'domestic_vendor'
            ? 'border-emerald-600 text-emerald-700'
            : 'border-transparent text-navy-500 hover:text-emerald-700'
        }`}
      >
        🌾 농수산물
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-mono text-emerald-700">
          {supplyCounts.domestic}
        </span>
      </Link>
      {supplyCounts.none > 0 && (
        <span className="ml-2 text-xs text-navy-400">
          미분류 {supplyCounts.none}개
        </span>
      )}
    </nav>
  );
}

interface StageFilterChipsProps {
  activeStages: PipelineStage[];
  counts: Record<PipelineStage, number>;
  totalCount: number;
  currentSupply: SupplyFilter;
}

function StageFilterChips({ activeStages, counts, totalCount, currentSupply }: StageFilterChipsProps) {
  const isAll = activeStages.length === 0;

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="단계 필터">
      <Link
        href={buildHref(undefined, currentSupply)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
          isAll
            ? 'border-teal-300 bg-teal-50 text-teal-700'
            : 'border-navy-200 bg-white text-navy-600 hover:border-teal-200 hover:text-teal-700'
        }`}
      >
        전체
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
          {totalCount}
        </span>
      </Link>
      {PIPELINE_STAGES.map((stage) => {
        const meta = PIPELINE_STAGE_META[stage];
        const isActive = activeStages.includes(stage);
        const count = counts[stage];
        return (
          <Link
            key={stage}
            href={buildHref(stage, currentSupply)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isActive
                ? `border-teal-300 ${meta.bgColor} ${meta.color}`
                : 'border-navy-200 bg-white text-navy-600 hover:border-teal-200 hover:text-teal-700'
            }`}
          >
            {meta.label}
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────
// 상품 카드
// ─────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Awaited<ReturnType<typeof listProducts>>[number];
}

function ProductCard({ product }: ProductCardProps) {
  const stageMeta = isPipelineStage(product.status)
    ? PIPELINE_STAGE_META[product.status]
    : null;

  const cogsCny = product.cogs_cny !== null ? Number(product.cogs_cny) : null;
  const cogsKrw = product.cogs_krw !== null ? Number(product.cogs_krw) : null;
  const sellingKrw = product.selling_price_krw !== null ? Number(product.selling_price_krw) : null;
  const margin = product.margin_rate !== null ? Number(product.margin_rate) : null;

  // 농수산물 (domestic_vendor) 은 위안 안 씀 — 한국 원가만 표시
  const isDomestic = product.supply_type === 'domestic_vendor';

  return (
    <li>
      <Link
        href={`/products/${product.id}`}
        className="group block rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
      >
        {/* 상단: 코드 + 단계 배지 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-navy-400">
              {product.code}
            </div>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-navy-900 group-hover:text-teal-700">
              {product.name}
            </h3>
          </div>
          {stageMeta && (
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${stageMeta.bgColor} ${stageMeta.color}`}
              title={stageMeta.description}
            >
              {stageMeta.label}
            </span>
          )}
        </div>

        {/* 카테고리 */}
        {product.category && (
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-navy-500">
            <Tag className="h-3 w-3 text-navy-400" aria-hidden />
            <span>{product.category}</span>
          </div>
        )}

        {/* 가격 정보 — 농수산물(domestic_vendor) 은 ₩ 만 / 공산품은 ¥ + ₩ */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          {isDomestic ? (
            <PriceCell
              label="원가(₩)"
              value={cogsKrw !== null ? cogsKrw.toLocaleString('ko-KR', { maximumFractionDigits: KRW_DECIMALS }) : '미입력'}
              confidence={product.cogs_cny_confidence as ConfidenceLevel | null}
            />
          ) : (
            <PriceCell
              label="원가(¥)"
              value={cogsCny !== null ? cogsCny.toFixed(CNY_DECIMALS) : '미입력'}
              confidence={product.cogs_cny_confidence as ConfidenceLevel | null}
            />
          )}
          <PriceCell
            label="판매가(₩)"
            value={sellingKrw !== null ? sellingKrw.toLocaleString('ko-KR', { maximumFractionDigits: KRW_DECIMALS }) : '미입력'}
            confidence={null}
          />
          <PriceCell
            label="마진"
            value={margin !== null ? `${(margin * PERCENT_MULTIPLIER).toFixed(1)}%` : '미입력'}
            confidence={product.margin_rate_confidence as ConfidenceLevel | null}
          />
        </div>

        {/* 시장 메트릭 (검색량 / 피크월 / 평균 리뷰) */}
        <MarketMetricsRow product={product} />

        {/* 시장 가격 (쿠팡 + 네이버 1~10등 가격대) */}
        <MarketPriceRow product={product} />

        {/* 하단: 등록일 + 화살표 */}
        <div className="mt-3 flex items-center justify-between border-t border-navy-100 pt-2">
          <div className="flex items-center gap-2 text-[10px] text-navy-400">
            <User className="h-3 w-3" aria-hidden />
            <span>등록 {formatDate(product.created_at)}</span>
          </div>
          <ArrowRight
            className="h-3 w-3 text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600"
            aria-hidden
          />
        </div>
      </Link>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 시장 가격 행 (쿠팡 + 네이버 1~10등)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 시장 메트릭 행 — 월간 검색량 + 피크월 + 평균 리뷰
// ─────────────────────────────────────────────────────────

const MONTH_NAMES_KO = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

interface MarketMetricsRowProps {
  product: Awaited<ReturnType<typeof listProducts>>[number];
}

function MarketMetricsRow({ product }: MarketMetricsRowProps) {
  const peakMonth = product.season_peak_month;
  const prepMonth = product.season_prep_month;
  const seasonRatio = product.seasonality_ratio !== null ? Number(product.seasonality_ratio) : null;
  const lowReviewN = product.coupang_low_review_count;
  const sampleSize = product.coupang_price_sample_size ?? 0;
  const maxReview = product.coupang_max_review_count;

  // 형 핵심 기준: 리뷰 300 이하 진입 자리
  // 12+/20 = 블루오션, 6+/20 = 진입 가능, 2+/20 = 경쟁, 0~1 = 포화
  const entryGrade =
    lowReviewN === null || sampleSize === 0
      ? null
      : lowReviewN >= 12
        ? { label: 'S', text: '블루오션', color: 'bg-emerald-100 text-emerald-700' }
        : lowReviewN >= 6
          ? { label: 'A', text: '진입 가능', color: 'bg-blue-100 text-blue-700' }
          : lowReviewN >= 2
            ? { label: 'B', text: '경쟁 심함', color: 'bg-amber-100 text-amber-700' }
            : { label: 'C', text: '포화', color: 'bg-red-100 text-red-700' };

  const hasAny = peakMonth !== null || lowReviewN !== null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-navy-100 bg-blue-50/30 p-2 text-[10px]">
      {/* 피크월 + 시즌성 */}
      <div>
        <div className="text-[9px] font-semibold uppercase text-navy-500">피크월</div>
        {peakMonth ? (
          <div className="mt-0.5">
            <span className="font-mono text-sm font-bold text-emerald-700">
              {MONTH_NAMES_KO[peakMonth]}
            </span>
            {seasonRatio !== null && seasonRatio > 0 && (
              <span className="ml-1 text-[9px] text-emerald-600">×{seasonRatio.toFixed(1)}</span>
            )}
            {prepMonth && (
              <div className="text-[9px] text-navy-500">준비 {MONTH_NAMES_KO[prepMonth]}</div>
            )}
          </div>
        ) : (
          <div className="mt-0.5 text-navy-400">상시</div>
        )}
      </div>

      {/* 쿠팡 진입 자리 — 형 핵심 기준 */}
      <div>
        <div className="text-[9px] font-semibold uppercase text-navy-500">
          쿠팡 진입 자리 <span className="text-navy-400">(리뷰 300 이하)</span>
        </div>
        {lowReviewN !== null && sampleSize > 0 ? (
          <div className="mt-0.5">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-sm font-bold text-navy-900">
                {lowReviewN}/{sampleSize}
              </span>
              {entryGrade && (
                <span className={`rounded px-1 py-0 text-[8px] font-bold ${entryGrade.color}`}>
                  {entryGrade.label} {entryGrade.text}
                </span>
              )}
            </div>
            {maxReview !== null && (
              <div className="text-[9px] text-navy-400">
                최대 리뷰 {maxReview.toLocaleString('ko-KR')}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-0.5 text-navy-400">—</div>
        )}
      </div>

      {!hasAny && (
        <div className="col-span-2 text-center text-[9px] text-navy-400">
          📊 쿠팡 워커 실행 후 자동 채워짐
        </div>
      )}
    </div>
  );
}

interface MarketPriceRowProps {
  product: Awaited<ReturnType<typeof listProducts>>[number];
}

interface NaverListing {
  rank: number;
  title: string;
  price: number;
  mall: string | null;
  link: string;
}

interface CoupangListing {
  rank: number;
  title: string;
  price: number | null;
  isRocket: boolean;
  reviewCount: number;
  url: string | null;
}

function MarketPriceRow({ product }: MarketPriceRowProps) {
  const cgN = product.coupang_price_sample_size ?? 0;
  const nvN = product.naver_price_sample_size ?? 0;

  const cgListings = (product.coupang_top_listings ?? null) as CoupangListing[] | null;
  const nvListings = (product.naver_top_listings ?? null) as NaverListing[] | null;

  const hasAny = (cgListings && cgListings.length > 0) || (nvListings && nvListings.length > 0);

  return (
    <div className="mt-2 rounded border border-navy-100 bg-navy-50/30 p-2 text-[10px]">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[9px] font-semibold uppercase text-navy-500">
          시장 1~10등 가격
        </span>
        {product.market_prices_updated_at && (
          <span className="text-[8px] text-navy-300">
            {formatDate(product.market_prices_updated_at)}
          </span>
        )}
      </div>
      {!hasAny ? (
        <div className="text-navy-400">📊 데이터 없음</div>
      ) : (
        <div className="space-y-2">
          {/* 네이버 1~10등 */}
          {nvListings && nvListings.length > 0 && (
            <div>
              <div className="mb-0.5 flex items-center gap-1 text-navy-600">
                <span className="font-semibold">🟢 네이버</span>
                <span className="text-[9px] text-navy-400">({nvN}개)</span>
              </div>
              <ol className="space-y-0.5 font-mono">
                {nvListings.slice(0, 10).map((l) => (
                  <li key={l.rank} className="flex items-baseline gap-1">
                    <span className="w-4 shrink-0 text-[9px] text-navy-400">{l.rank}.</span>
                    <span className="flex-1 truncate text-[10px] text-navy-700" title={l.title}>
                      {l.title}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-navy-900">
                      {l.price.toLocaleString('ko-KR')}원
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 쿠팡 1~20등 (있을 때만) */}
          {cgListings && cgListings.length > 0 && (
            <div className="border-t border-navy-100 pt-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-navy-600">
                <span className="font-semibold">🚀 쿠팡</span>
                <span className="text-[9px] text-navy-400">({cgN}개)</span>
              </div>
              <ol className="space-y-0.5 font-mono">
                {cgListings.slice(0, 10).map((l) => (
                  <li key={l.rank} className="flex items-baseline gap-1">
                    <span className="w-4 shrink-0 text-[9px] text-navy-400">{l.rank}.</span>
                    <span className="flex-1 truncate text-[10px] text-navy-700" title={l.title}>
                      {l.isRocket && <span className="mr-0.5">🚀</span>}
                      {l.title}
                    </span>
                    <span className="shrink-0 text-[9px] text-navy-500">
                      리뷰 {l.reviewCount.toLocaleString('ko-KR')}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-navy-900">
                      {l.price !== null ? `${l.price.toLocaleString('ko-KR')}원` : '-'}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 가격 셀 (라벨 + 값 + 신뢰도 점)
// ─────────────────────────────────────────────────────────

interface PriceCellProps {
  label: string;
  value: string;
  confidence: ConfidenceLevel | null;
}

function PriceCell({ label, value, confidence }: PriceCellProps) {
  const conf = confidence ?? 'unknown';
  const meta = CONFIDENCE_META[conf];
  return (
    <div>
      <div className="text-[9px] uppercase text-navy-400">{label}</div>
      <div className="mt-0.5 flex items-center gap-1">
        <span className="font-mono text-navy-700">{value}</span>
        <span
          className={`rounded px-1 py-0 text-[8px] font-semibold ${meta.color}`}
          title={`신뢰도: ${meta.label}`}
        >
          {meta.label}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <Package className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">
        {hasFilter ? '이 단계에 해당하는 상품이 없습니다' : '아직 등록된 상품이 없습니다'}
      </h2>
      <p className="mt-1 text-xs text-navy-500">
        {hasFilter
          ? '필터를 해제하거나 다른 단계를 선택해보세요.'
          : '첫 번째 상품을 등록하면 6단계 파이프라인이 시작됩니다.'}
      </p>
      {!hasFilter && (
        <Link
          href="/products/new"
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" aria-hidden />첫 상품 등록하기
        </Link>
      )}
      {hasFilter && (
        <Link
          href="/products"
          className="mt-4 inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
        >
          전체 보기
        </Link>
      )}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">상품 목록을 불러올 수 없습니다</div>
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

function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

function formatDate(date: Date): string {
  try {
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(date);
  }
}
