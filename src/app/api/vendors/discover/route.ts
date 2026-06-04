/**
 * /api/vendors/discover — 외부 공급처 발굴 (네이버 + 카카오)
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2.5번 PR
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * GET ?q=고체+탈취제
 *
 * 응답: { query, naverHits, brandCandidates, candidates: [...] }
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireCompanyContext } from '@/lib/auth/session';
import { discoverExternalVendors } from '@/lib/research/external-vendor-discover';

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireCompanyContext();
  } catch {
    return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: HTTP_BAD_REQUEST });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json(
      { ok: false, error: '검색어는 2자 이상' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const result = await discoverExternalVendors(q);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[discover] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '검색 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
