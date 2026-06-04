/**
 * /api/vendors/[id]/call-logs — 통화 기록 INSERT (immutable)
 *
 * POST: 새 통화 결과 + 공급가 기록
 *
 * 형 요청: 통화 후 30초 안에 기록 (3번 PR 빠른 버전)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { and, desc, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { vendorCallLogs, vendors } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL = 500;

const ALLOWED_CHANNELS = ['phone', 'kakao', 'visit', 'other'] as const;
const ALLOWED_RESULTS = ['연결됨', '부재중', '거절', '견본_요청', '거래_시작', '탈락'] as const;
const ALLOWED_NEXT_ACTIONS = ['재통화', '견본_대기', '계약_검토'] as const;

interface PostBody {
  product_id?: string | null;
  channel?: (typeof ALLOWED_CHANNELS)[number];
  result?: (typeof ALLOWED_RESULTS)[number];
  notes?: string;
  next_action?: (typeof ALLOWED_NEXT_ACTIONS)[number] | null;
  next_action_at?: string | null; // ISO date
  supplier_price?: number | null;
  supplier_price_unit?: string | null;
  moq?: number | null;
  moq_unit?: string | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

// ────────────────────────────────────────────────────────────
// POST — 통화 기록 INSERT
// ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: Ctx) {
  let auth;
  try {
    auth = await requireCompanyContext();
  } catch {
    return NextResponse.json(
      { ok: false, error: '로그인 필요' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const { id: vendorId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(vendorId)) {
    return NextResponse.json({ ok: false, error: '잘못된 vendor id' }, { status: HTTP_BAD_REQUEST });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON body 오류' }, { status: HTTP_BAD_REQUEST });
  }

  if (!body.channel || !ALLOWED_CHANNELS.includes(body.channel)) {
    return NextResponse.json(
      { ok: false, error: `channel 필수: ${ALLOWED_CHANNELS.join(' / ')}` },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (!body.result || !ALLOWED_RESULTS.includes(body.result)) {
    return NextResponse.json(
      { ok: false, error: `result 필수: ${ALLOWED_RESULTS.join(' / ')}` },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (body.next_action != null && !ALLOWED_NEXT_ACTIONS.includes(body.next_action)) {
    return NextResponse.json(
      { ok: false, error: `next_action 은 ${ALLOWED_NEXT_ACTIONS.join(' / ')} 중 하나` },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const inserted = await withCompanyContext(auth.companyId, async (tx) => {
      // vendor 확인 (RLS 가 다른 회사 차단)
      const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
      if (!vendor) return null;

      const [row] = await tx
        .insert(vendorCallLogs)
        .values({
          company_id: auth.companyId,
          vendor_id: vendorId,
          product_id: body.product_id ?? null,
          channel: body.channel!,
          result: body.result!,
          notes: body.notes ?? null,
          next_action: body.next_action ?? null,
          next_action_at: body.next_action_at ? new Date(body.next_action_at) : null,
          supplier_price: body.supplier_price?.toString() ?? null,
          supplier_price_unit: body.supplier_price_unit ?? null,
          moq: body.moq ?? null,
          moq_unit: body.moq_unit ?? null,
          called_by_user_id: auth.userId,
        })
        .returning();
      return row;
    });

    if (!inserted) {
      return NextResponse.json({ ok: false, error: 'vendor 찾을 수 없음' }, { status: HTTP_NOT_FOUND });
    }

    return NextResponse.json({ ok: true, log: inserted });
  } catch (err) {
    console.error('[vendor call-logs POST] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '저장 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}

// ────────────────────────────────────────────────────────────
// GET — 통화 기록 타임라인
// ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, ctx: Ctx) {
  let auth;
  try {
    auth = await requireCompanyContext();
  } catch {
    return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: HTTP_BAD_REQUEST });
  }

  const { id: vendorId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(vendorId)) {
    return NextResponse.json({ ok: false, error: '잘못된 vendor id' }, { status: HTTP_BAD_REQUEST });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('product_id');

  try {
    const logs = await withCompanyContext(auth.companyId, async (tx) => {
      const conditions = [eq(vendorCallLogs.vendor_id, vendorId)];
      if (productId) conditions.push(eq(vendorCallLogs.product_id, productId));
      return tx
        .select()
        .from(vendorCallLogs)
        .where(and(...conditions))
        .orderBy(desc(vendorCallLogs.called_at))
        .limit(50);
    });
    return NextResponse.json({ ok: true, logs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
