/**
 * /api/products/[id]/vendor-candidates
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2번 PR
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4/P-5 (RLS)
 * ADR: ADR-012 (vendors), ADR-013 D-3 (회사 격리)
 *
 * GET — 상품에 대한 농가 자동 매칭 결과 + 기존 후보(product_vendor_candidates) 통합
 * POST — 후보 추가 (status='후보') 또는 상태 변경 (예: '후보' → '탈락')
 */
import { NextResponse, type NextRequest } from 'next/server';

import { and, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { productVendorCandidates, products } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { matchVendorsForProduct } from '@/lib/vendors/match';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL = 500;

const ALLOWED_STATUSES = ['후보', '통화중', '견본중', '확정', '탈락'] as const;
type VendorCandidateStatus = (typeof ALLOWED_STATUSES)[number];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ────────────────────────────────────────────────────────────
// GET — 자동 매칭 + 기존 후보 통합
// ────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: RouteContext) {
  let auth;
  try {
    auth = await requireCompanyContext();
  } catch {
    return NextResponse.json(
      { ok: false, error: '로그인이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const { id: productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return NextResponse.json(
      { ok: false, error: '잘못된 product id 형식' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const result = await withCompanyContext(auth.companyId, async (tx) => {
      // 1) 상품 조회 (RLS 가 다른 회사 차단)
      const productRows = (await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1)) as Array<typeof products.$inferSelect>;
      const product = productRows[0];
      if (!product) return null;

      // 2) 자동 매칭 알고리즘 호출
      const matches = await matchVendorsForProduct(tx, {
        productName: product.name,
        seasonPeakMonth: product.season_peak_month,
        seasonPrepMonth: product.season_prep_month,
      });

      // 3) 기존 후보 (product_vendor_candidates) 조회
      const existingCandidates = (await tx
        .select()
        .from(productVendorCandidates)
        .where(eq(productVendorCandidates.product_id, productId))) as Array<
        typeof productVendorCandidates.$inferSelect
      >;

      // 각 vendor_id 의 기존 상태 / 메모 매핑
      const candidateByVendorId = new Map(existingCandidates.map((c) => [c.vendor_id, c]));

      return { product, matches, existingCandidates, candidateByVendorId };
    });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: '상품을 찾을 수 없습니다.' },
        { status: HTTP_NOT_FOUND },
      );
    }

    return NextResponse.json({
      ok: true,
      product: {
        id: result.product.id,
        name: result.product.name,
        supply_type: result.product.supply_type,
        season_peak_month: result.product.season_peak_month,
        season_prep_month: result.product.season_prep_month,
        seasonality_ratio: result.product.seasonality_ratio,
        season_score: result.product.season_score,
        primary_vendor_id: result.product.primary_vendor_id,
      },
      matches: result.matches.map((m) => {
        const existing = result.candidateByVendorId.get(m.vendor.id);
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
          candidateStatus: existing?.status ?? null,
          candidateId: existing?.id ?? null,
        };
      }),
      stats: {
        autoMatched: result.matches.length,
        existingCandidates: result.existingCandidates.length,
      },
    });
  } catch (err) {
    console.error('[products/vendor-candidates GET] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '자동 매칭 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}

// ────────────────────────────────────────────────────────────
// POST — 후보 추가 / 상태 변경
// ────────────────────────────────────────────────────────────

interface PostBody {
  vendor_id?: string;
  status?: VendorCandidateStatus;
  match_score?: number;
  match_reason?: string;
  notes?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  let auth;
  try {
    auth = await requireCompanyContext();
  } catch {
    return NextResponse.json(
      { ok: false, error: '로그인이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const { id: productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return NextResponse.json(
      { ok: false, error: '잘못된 product id' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'JSON body 가 잘못됨' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  if (!body.vendor_id || !/^[0-9a-f-]{36}$/i.test(body.vendor_id)) {
    return NextResponse.json(
      { ok: false, error: 'vendor_id 가 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const status: VendorCandidateStatus = body.status ?? '후보';
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { ok: false, error: `status 는 ${ALLOWED_STATUSES.join(' / ')} 중 하나` },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const result = await withCompanyContext(auth.companyId, async (tx) => {
      // 상품 존재 + 같은 회사인지 확인
      const productRows = (await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1)) as Array<typeof products.$inferSelect>;
      if (!productRows[0]) return { ok: false as const, reason: 'not_found' };

      // upsert 패턴: 기존 후보가 있으면 status / notes 업데이트, 없으면 INSERT
      const existing = (await tx
        .select()
        .from(productVendorCandidates)
        .where(
          and(
            eq(productVendorCandidates.product_id, productId),
            eq(productVendorCandidates.vendor_id, body.vendor_id!),
          ),
        )
        .limit(1)) as Array<typeof productVendorCandidates.$inferSelect>;

      if (existing[0]) {
        const updated = (await tx
          .update(productVendorCandidates)
          .set({
            status,
            notes: body.notes ?? existing[0].notes,
            updated_at: new Date(),
          })
          .where(eq(productVendorCandidates.id, existing[0].id))
          .returning()) as Array<typeof productVendorCandidates.$inferSelect>;
        return { ok: true as const, action: 'updated' as const, row: updated[0] };
      }

      const inserted = (await tx
        .insert(productVendorCandidates)
        .values({
          company_id: auth.companyId,
          product_id: productId,
          vendor_id: body.vendor_id!,
          status,
          match_score: body.match_score?.toString() ?? null,
          match_reason: body.match_reason ?? null,
          notes: body.notes ?? null,
          created_by: auth.userId,
        })
        .returning()) as Array<typeof productVendorCandidates.$inferSelect>;
      return { ok: true as const, action: 'inserted' as const, row: inserted[0] };
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: '상품을 찾을 수 없습니다.' },
        { status: HTTP_NOT_FOUND },
      );
    }

    return NextResponse.json({
      ok: true,
      action: result.action,
      candidate: result.row,
    });
  } catch (err) {
    console.error('[products/vendor-candidates POST] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '후보 저장 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
