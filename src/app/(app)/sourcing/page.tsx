/**
 * /sourcing — 수입 의뢰 (상품 + 공급사 + 견적)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 수입 의뢰 대기 상품 목록 (research → sourcing으로 넘어온 것들)
 * - 각 상품별 원가/판매가 메모 + "수입중"으로 넘기기 버튼
 * - 공급사 관리 + 견적 목록 바로가기
 */
import Link from 'next/link';

import {
  ArrowRight,
  Building2,
  Calculator,
  ExternalLink,
  Plus,
  ReceiptText,
  ShoppingCart,
  Star,
} from 'lucide-react';

import { CostCalculator } from '@/components/pricing/cost-calculator';
import { requireCompanyContext } from '@/lib/auth/session';
import { savePricingAction, transitionProductStatusAction } from '@/lib/products/actions';
import { listProducts } from '@/lib/products/queries';
import { listSuppliers, type SupplierSource } from '@/lib/sourcing/suppliers';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 50;
const MAX_RATING_STARS = 5;

export default async function SourcingPage() {
  const ctx = await requireCompanyContext();

  // 병렬 조회: sourcing 단계 상품 + 공급사
  let sourcingProducts: Awaited<ReturnType<typeof listProducts>> = [];
  let suppliers: Awaited<ReturnType<typeof listSuppliers>> = [];
  let dbError: string | null = null;

  try {
    [sourcingProducts, suppliers] = await Promise.all([
      listProducts({ companyId: ctx.companyId, stages: ['sourcing'], limit: LIST_LIMIT }),
      listSuppliers({ companyId: ctx.companyId, limit: LIST_LIMIT }),
    ]);
  } catch (err) {
    console.error('[sourcing] 조회 실패:', err);
    dbError =
      err instanceof Error ? err.message : '데이터를 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-yellow-600">
          <ShoppingCart className="h-4 w-4" aria-hidden />
          Step 2
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">수입 의뢰</h1>
            <p className="mt-1 text-sm text-navy-500">
              검증 완료된 상품의 견적을 받고 원가/판매가를 결정합니다.
              확정되면 수입 단계로 넘깁니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sourcing/quotes"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <ReceiptText className="h-3.5 w-3.5" aria-hidden />
              견적 목록
            </Link>
            <Link
              href="/sourcing/suppliers/new"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              공급사 등록
            </Link>
          </div>
        </div>
      </header>

      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : (
        <>
          {/* 수입 의뢰 대기 상품 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
              의뢰 대기 상품 ({sourcingProducts.length}개)
            </h2>
            {sourcingProducts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
                <Calculator className="mx-auto h-10 w-10 text-navy-300" />
                <h3 className="mt-3 text-base font-semibold text-navy-700">
                  수입 의뢰 대기 상품이 없습니다
                </h3>
                <p className="mt-1 text-xs text-navy-500">
                  상품 발굴에서 검증이 끝난 상품을 &quot;수입 의뢰로&quot; 보내면 여기에 표시됩니다.
                </p>
                <Link
                  href="/research"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-800"
                >
                  상품 발굴로 가기 →
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {sourcingProducts.map((item) => (
                  <SourcingProductCard key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>

          {/* 공급사 목록 (컴팩트) */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
                공급사 ({suppliers.length}곳)
              </h2>
              <Link
                href="/sourcing/suppliers/new"
                className="text-xs font-semibold text-teal-700 hover:text-teal-800"
              >
                + 등록
              </Link>
            </div>
            {suppliers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-6 text-center">
                <Building2 className="mx-auto h-8 w-8 text-navy-300" />
                <p className="mt-2 text-xs text-navy-500">
                  수입대행 업체를 등록해두면 견적 관리가 편해집니다.
                </p>
                <Link
                  href="/sourcing/suppliers/new"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                  <Plus className="h-3 w-3" /> 첫 공급사 등록
                </Link>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {suppliers.map((s) => (
                  <SupplierCompactCard key={s.id} supplier={s} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 수입 의뢰 대기 상품 카드
// ─────────────────────────────────────────────────────────

interface SourcingProductCardProps {
  item: Awaited<ReturnType<typeof listProducts>>[number];
}

function SourcingProductCard({ item }: SourcingProductCardProps) {
  const lines = (item.description ?? '').split('\n');
  const sourceLine = lines.find((l) => l.startsWith('소스: '));
  const sourceUrl = sourceLine ? sourceLine.replace('소스: ', '').trim() : null;
  const memo = lines.filter((l) => !l.startsWith('소스: ')).join(' ').trim();

  const hasPrice = item.selling_price_krw !== null;
  const hasCostKrw = item.cogs_krw !== null;

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-4">
      {/* 상단: 상품 정보 + 전환 버튼 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/products/${item.id}`}
              className="text-sm font-semibold text-navy-900 hover:text-teal-700"
            >
              {item.name}
            </Link>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
              {item.code}
            </span>
          </div>

          {/* 현재 가격 요약 */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            <span className={hasCostKrw ? 'text-navy-700' : 'text-navy-400'}>
              원가: {hasCostKrw ? `₩${Number(item.cogs_krw).toLocaleString('ko-KR')}` : '미정'}
            </span>
            <span className={hasPrice ? 'text-navy-700' : 'text-navy-400'}>
              판매가: {hasPrice ? `₩${Number(item.selling_price_krw).toLocaleString('ko-KR')}` : '미정'}
            </span>
            {item.margin_rate !== null && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                마진 {(Number(item.margin_rate) * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="h-3 w-3" />
              소스 링크
            </a>
          )}
          {memo && <p className="mt-1 text-xs text-navy-500">{memo}</p>}
        </div>

        {/* 수입중으로 넘기기 */}
        <form action={transitionProductStatusAction}>
          <input type="hidden" name="productId" value={item.id} />
          <input type="hidden" name="toStatus" value="importing" />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition hover:bg-purple-100"
          >
            수입중으로
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
      </div>

      {/* 원가 계산기 (접힌 상태 없이 항상 표시) */}
      <div className="mt-3">
        <CostCalculator
          productId={item.id}
          initialCost={hasCostKrw ? Number(item.cogs_krw) : undefined}
          initialPrice={hasPrice ? Number(item.selling_price_krw) : undefined}
          saveAction={savePricingAction}
        />
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 공급사 컴팩트 카드
// ─────────────────────────────────────────────────────────

const SOURCE_META: Record<SupplierSource, { label: string; color: string }> = {
  '1688': { label: '1688', color: 'bg-orange-50 text-orange-700' },
  taobao: { label: '타오바오', color: 'bg-pink-50 text-pink-700' },
  domestic: { label: '국내', color: 'bg-blue-50 text-blue-700' },
  other: { label: '기타', color: 'bg-navy-50 text-navy-600' },
};

interface SupplierCompactCardProps {
  supplier: Awaited<ReturnType<typeof listSuppliers>>[number];
}

function SupplierCompactCard({ supplier }: SupplierCompactCardProps) {
  const sourceMeta =
    SOURCE_META[supplier.source as SupplierSource] ?? SOURCE_META.other;

  return (
    <li>
      <Link
        href={`/sourcing/suppliers/${supplier.id}`}
        className="group flex items-center gap-3 rounded-lg border border-navy-200 bg-white p-3 transition hover:border-teal-300"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50">
          <Building2 className="h-4 w-4 text-teal-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-navy-900 group-hover:text-teal-700">
              {supplier.name}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${sourceMeta.color}`}>
              {sourceMeta.label}
            </span>
          </div>
          {supplier.rating !== null && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px]">
              <RatingStars value={supplier.rating} />
            </div>
          )}
        </div>
        <ArrowRight className="h-3 w-3 shrink-0 text-navy-300 group-hover:text-teal-500" />
      </Link>
    </li>
  );
}

function RatingStars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(MAX_RATING_STARS, value));
  return (
    <span className="inline-flex" aria-label={`평점 ${filled}/${MAX_RATING_STARS}`}>
      {Array.from({ length: MAX_RATING_STARS }, (_, i) => (
        <Star
          key={i}
          className={`h-2.5 w-2.5 ${
            i < filled ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-navy-200'
          }`}
          aria-hidden
        />
      ))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// 에러 패널
// ─────────────────────────────────────────────────────────

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">데이터를 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결을 확인하세요. (`npm run db:push`)
      </p>
    </div>
  );
}
