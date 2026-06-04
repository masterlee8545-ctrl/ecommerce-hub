/**
 * /api/vendors/[id]/status — 농가 영업 상태 변경
 *
 * PATCH: work_status + status_note 업데이트
 */
import { NextResponse, type NextRequest } from 'next/server';

import { eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { vendors } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL = 500;

const ALLOWED_STATUSES = [
  'active',
  'no_phone',
  'no_answer',
  'sourcing_failed',
  'dropped',
  'contracted',
] as const;
type WorkStatus = (typeof ALLOWED_STATUSES)[number];

interface PatchBody {
  work_status?: WorkStatus;
  status_note?: string | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
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

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON body 오류' }, { status: HTTP_BAD_REQUEST });
  }

  if (body.work_status && !ALLOWED_STATUSES.includes(body.work_status)) {
    return NextResponse.json(
      { ok: false, error: `status 는 ${ALLOWED_STATUSES.join(' / ')} 중 하나` },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const updated = await withCompanyContext(auth.companyId, async (tx) => {
      const patch: {
        work_status?: WorkStatus;
        status_note?: string | null;
        status_updated_at: Date;
        updated_at: Date;
      } = {
        status_updated_at: new Date(),
        updated_at: new Date(),
      };
      if (body.work_status !== undefined) patch.work_status = body.work_status;
      if (body.status_note !== undefined) patch.status_note = body.status_note;

      const [row] = await tx
        .update(vendors)
        .set(patch)
        .where(eq(vendors.id, vendorId))
        .returning({
          id: vendors.id,
          work_status: vendors.work_status,
          status_note: vendors.status_note,
          status_updated_at: vendors.status_updated_at,
        });
      return row;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: 'vendor 찾을 수 없음' }, { status: HTTP_NOT_FOUND });
    }

    return NextResponse.json({ ok: true, vendor: updated });
  } catch (err) {
    console.error('[vendor status PATCH] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '저장 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
