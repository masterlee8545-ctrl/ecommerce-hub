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

import { ArrowRight, Package, Plus, Tag, User } from 'lucide-react';

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
  searchParams: Promise<{ stage?: string }>;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const ctx = await requireCompanyContext();
  const sp = await searchParams;
  const stages = parsePipelineStageFilter(sp.stage);

  // DB 조회 — 실패 시 빈 배열로 폴백
  let rows: Awaited<ReturnType<typeof listProducts>> = [];
  let counts: Record<PipelineStage, number> | null = null;
  let dbError: string | null = null;
  try {
    const listArgs: Parameters<typeof listProducts>[0] = {
      companyId: ctx.companyId,
      stages,
      limit: PRODUCTS_LIMIT,
    };
    // operator 는 자기에게 배정된 상품만 표시
    if (ctx.role === 'operator') {
      listArgs.assigneeUserId = ctx.userId;
    }
    [rows, counts] = await Promise.all([
      listProducts(listArgs),
      countProductsByStage(ctx.companyId),
    ]);
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

      {/* 단계 필터 칩 */}
      {counts && (
        <StageFilterChips activeStages={stages} counts={counts} totalCount={totalCount} />
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

interface StageFilterChipsProps {
  activeStages: PipelineStage[];
  counts: Record<PipelineStage, number>;
  totalCount: number;
}

function StageFilterChips({ activeStages, counts, totalCount }: StageFilterChipsProps) {
  const isAll = activeStages.length === 0;

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="단계 필터">
      <Link
        href="/products"
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
            href={`/products?stage=${stage}`}
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
  const sellingKrw = product.selling_price_krw !== null ? Number(product.selling_price_krw) : null;
  const margin = product.margin_rate !== null ? Number(product.margin_rate) : null;

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

        {/* 가격 정보 */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <PriceCell
            label="원가(¥)"
            value={cogsCny !== null ? cogsCny.toFixed(CNY_DECIMALS) : '—'}
            confidence={product.cogs_cny_confidence as ConfidenceLevel | null}
          />
          <PriceCell
            label="판매가(₩)"
            value={sellingKrw !== null ? sellingKrw.toLocaleString('ko-KR', { maximumFractionDigits: KRW_DECIMALS }) : '—'}
            confidence={null}
          />
          <PriceCell
            label="마진"
            value={margin !== null ? `${(margin * PERCENT_MULTIPLIER).toFixed(1)}%` : '—'}
            confidence={product.margin_rate_confidence as ConfidenceLevel | null}
          />
        </div>

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
