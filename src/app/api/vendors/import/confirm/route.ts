/**
 * /api/vendors/import/confirm
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-2/P-4/P-5
 *
 * 동작:
 *   클라이언트가 preview 후 "확정" 누르면 같은 CSV 를 다시 업로드.
 *   서버는 한 트랜잭션 안에서 INSERT/UPDATE 모두 적용.
 *
 *   - INSERT 신규 vendors
 *   - UPDATE 기존 vendors 의 also_listed_on
 *   - INSERT vendor_products (키워드 분해, ON CONFLICT DO NOTHING)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { withCompanyContext } from '@/db';
import { requireCompanyContext } from '@/lib/auth/session';
import { confirmImport, previewImport } from '@/lib/vendors/import';

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_INTERNAL = 500;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireCompanyContext();
  } catch (err) {
    console.error('[vendors/import/confirm] auth 실패:', err);
    return NextResponse.json(
      { ok: false, error: '로그인이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error('[vendors/import/confirm] formData 파싱 실패:', err);
    return NextResponse.json(
      { ok: false, error: 'multipart/form-data 형식이 아닙니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: 'file 필드가 누락되었습니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { ok: false, error: '빈 파일입니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `파일이 너무 큽니다. 최대 ${MAX_FILE_BYTES / 1024 / 1024}MB.` },
      { status: HTTP_PAYLOAD_TOO_LARGE },
    );
  }

  let csvText: string;
  try {
    csvText = await file.text();
  } catch (err) {
    console.error('[vendors/import/confirm] 파일 읽기 실패:', err);
    return NextResponse.json(
      { ok: false, error: '파일을 텍스트로 읽을 수 없습니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const summary = await withCompanyContext(ctx.companyId, async (tx) => {
      const result = await previewImport({
        csvText,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        tx,
      });

      if (result.headerError) {
        throw new Error(result.headerError);
      }

      const applied = await confirmImport({
        result,
        companyId: ctx.companyId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });

      return {
        stats: result.stats,
        applied,
      };
    });

    return NextResponse.json({
      ok: true,
      stats: summary.stats,
      applied: summary.applied,
    });
  } catch (err) {
    console.error('[vendors/import/confirm] confirm 실패:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '임포트 실패',
      },
      { status: HTTP_INTERNAL },
    );
  }
}
