/**
 * /api/vendors/import/preview
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4/P-5 (멀티테넌트)
 *
 * 동작:
 *   1. multipart/form-data 로 CSV 파일 수신
 *   2. UTF-8 텍스트로 파싱
 *   3. previewImport() 호출 → 통계 + 행 액션 반환
 *   4. 클라이언트가 "확정" 누르면 동일 파일을 /confirm 으로 다시 전송
 *
 * 빈 파일 / 헤더 누락 / 권한 없음 등은 4xx 로 명시적 에러.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { withCompanyContext } from '@/db';
import { requireCompanyContext } from '@/lib/auth/session';
import { previewImport } from '@/lib/vendors/import';

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_INTERNAL = 500;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB (사이소 2,000 셀러 → 약 3MB)

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireCompanyContext();
  } catch (err) {
    console.error('[vendors/import/preview] auth 실패:', err);
    return NextResponse.json(
      { ok: false, error: '로그인이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error('[vendors/import/preview] formData 파싱 실패:', err);
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
    console.error('[vendors/import/preview] 파일 읽기 실패:', err);
    return NextResponse.json(
      { ok: false, error: '파일을 텍스트로 읽을 수 없습니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const result = await withCompanyContext(ctx.companyId, async (tx) => {
      return previewImport({
        csvText,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        tx,
      });
    });

    if (result.headerError) {
      return NextResponse.json(
        {
          ok: false,
          error: result.headerError,
          headerAnalysis: result.headerAnalysis,
        },
        { status: HTTP_BAD_REQUEST },
      );
    }

    // RowAction 안의 insertPayload 가 큰데 UI 미리보기엔 통계 + 첫 100건만 보내면 충분
    const previewRows = result.rows.slice(0, 100).map((r) => ({
      rawIndex: r.rawIndex,
      source_site: r.source_site,
      biz_name: r.biz_name,
      biz_no: r.biz_no,
      matchKind: r.match.matchKind,
      existingVendorName: r.match.existingVendor?.biz_name ?? null,
      alsoListedOn: r.alsoListedOn ?? null,
      keywordCount: r.keywords.length,
      errors: r.errors,
    }));

    return NextResponse.json({
      ok: true,
      headerAnalysis: result.headerAnalysis,
      stats: result.stats,
      previewRows,
      totalRows: result.rows.length,
    });
  } catch (err) {
    console.error('[vendors/import/preview] preview 실패:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '미리보기 생성 실패',
      },
      { status: HTTP_INTERNAL },
    );
  }
}
