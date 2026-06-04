/**
 * /products/[id]/find-vendor — 농가 자동 매칭 카드 + 후보 관리
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2번 PR
 * 헌법: CLAUDE.md §1 P-1 (없으면 notFound), §1 P-3 (점수 가중치 명시), §1 P-9
 * ADR: ADR-012 D-2 (supply_type='domestic_vendor' 일 때 진입), ADR-013 (회사 격리)
 *
 * 역할:
 *   - 자동 매칭된 농가 카드 그리드 (점수순)
 *   - 카드별 액션: [📞 통화] (3번 PR), [⭐ 후보 추가], [❌ 탈락]
 *   - 시즌 메타가 있으면 점수에 반영됨
 *   - supply_type 이 'overseas_supplier' 면 안내 + 도매상 페이지로 유도
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { eq } from 'drizzle-orm';
import { AlertCircle, ArrowLeft, Search, Sparkles } from 'lucide-react';

import { withCompanyContext } from '@/db';
import { productVendorCandidates, products } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { matchVendorsForProduct } from '@/lib/vendors/match';

import { VendorCandidatesClient, type VendorCard } from './client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FindVendorPage({ params }: PageProps) {
  const ctx = await requireCompanyContext();
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }

  const data = await withCompanyContext(ctx.companyId, async (tx) => {
    const productRows = (await tx
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1)) as Array<typeof products.$inferSelect>;
    const product = productRows[0];
    if (!product) return null;

    const matches = await matchVendorsForProduct(tx, {
      productName: product.name,
      seasonPeakMonth: product.season_peak_month,
      seasonPrepMonth: product.season_prep_month,
    });

    const existing = (await tx
      .select()
      .from(productVendorCandidates)
      .where(eq(productVendorCandidates.product_id, id))) as Array<
      typeof productVendorCandidates.$inferSelect
    >;

    return { product, matches, existing };
  });

  if (!data) notFound();

  // supply_type='overseas_supplier' 면 안내만 표시
  if (data.product.supply_type === 'overseas_supplier') {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Link
          href={`/products/${id}`}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          상품 상세로
        </Link>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <h2 className="text-lg font-semibold text-amber-900">
                이 상품은 해외 공급망입니다
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                상품의 공급망 유형이 <code>overseas_supplier</code> (중국 1688 등) 로
                지정되어 있어 농가 매칭이 노출되지 않습니다. 도매상(suppliers) 풀로 이동하세요.
              </p>
              <Link
                href={`/products/${id}#suppliers`}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                도매상 견적으로 이동 →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 자동 매칭 결과 + 기존 후보 통합해서 클라이언트로 전달
  const candidateByVendorId = new Map(data.existing.map((c) => [c.vendor_id, c]));

  const cards: VendorCard[] = data.matches.map((m) => {
    const existing = candidateByVendorId.get(m.vendor.id);
    const status = (existing?.status ?? null) as VendorCard['candidateStatus'];
    return {
      vendor: {
        id: m.vendor.id,
        biz_name: m.vendor.biz_name,
        biz_owner_name: m.vendor.biz_owner_name,
        biz_no: m.vendor.biz_no,
        biz_no_confidence: m.vendor.biz_no_confidence,
        repr_tel_no: m.vendor.repr_tel_no,
        biz_mobile: m.vendor.biz_mobile,
        biz_address: m.vendor.biz_address,
        biz_sector: m.vendor.biz_sector,
        classification: m.vendor.classification,
        product_count: m.vendor.product_count,
        product_keywords_all: m.vendor.product_keywords_all,
        source_site: m.vendor.source_site,
        also_listed_on: m.vendor.also_listed_on,
      },
      score: m.score,
      reasons: m.reasons,
      matchedKeywords: m.matchedKeywords,
      candidateStatus: status,
    };
  });

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <Link
        href={`/products/${id}`}
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        상품 상세로
      </Link>

      <header>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-600">
          <Sparkles className="h-5 w-5" aria-hidden />
          공급처 찾기
        </div>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">
          {data.product.name} — 농가 자동 매칭
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-navy-500">
          {data.product.supply_type && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              {data.product.supply_type}
            </span>
          )}
          {data.product.season_peak_month != null && (
            <span>
              피크 <strong>{data.product.season_peak_month}월</strong>
              {data.product.seasonality_ratio != null && (
                <span> (시즌성 {Number(data.product.seasonality_ratio).toFixed(1)}배)</span>
              )}
            </span>
          )}
          {data.product.season_prep_month != null && (
            <span>
              준비 <strong>{data.product.season_prep_month}월</strong>
            </span>
          )}
        </div>
      </header>

      {/* 매칭 결과 없음 안내 */}
      {cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-navy-300 bg-white p-8 text-center">
          <Search className="mx-auto h-10 w-10 text-navy-300" />
          <p className="mt-3 text-base font-medium text-navy-700">
            매칭되는 농가가 없어요.
          </p>
          <p className="mt-1 text-sm text-navy-500">
            상품명 &ldquo;<strong>{data.product.name}</strong>&rdquo; 에서 1차 농산물 키워드를 못 찾았거나, 등록된 농가 중 해당 품목 취급 농가가 없을 수 있어요.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/vendors"
              className="rounded-md border border-navy-300 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50"
            >
              농가 목록에서 직접 찾기
            </Link>
            <Link
              href="/vendors/import"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              CSV 임포트로 농가 추가
            </Link>
          </div>
        </div>
      )}

      {/* 매칭 결과 카드 */}
      {cards.length > 0 && (
        <VendorCandidatesClient productId={id} cards={cards} />
      )}
    </div>
  );
}
