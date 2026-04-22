/**
 * /api/batch-jobs — 배치 스크래핑 작업 큐
 *
 * POST: 키워드 배열 + 필터 → N개 job 을 pending 상태로 enqueue
 * GET:  회사의 최근 배치 목록 (대시보드용)
 *
 * 헌법: CLAUDE.md §1 P-2 (실패 명시), §1 P-4 (인증 강제)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { assertManager, PermissionError } from '@/lib/auth/permissions';
import { requireCompanyContext } from '@/lib/auth/session';
import { enqueueBatch, listRecentBatches } from '@/lib/sello-scraper/job-queue';

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const MAX_KEYWORDS_PER_BATCH = 50;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface EnqueueBody {
  keywords?: string[];
  filterCond?: unknown;
  forceFresh?: boolean;
}

export async function POST(request: NextRequest) {
  const ctx = await requireCompanyContext();

  try {
    assertManager(ctx.role, '배치 분석 시작');
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: HTTP_FORBIDDEN });
    }
    throw err;
  }

  let body: EnqueueBody;
  try {
    body = (await request.json()) as EnqueueBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'JSON 본문이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const keywords = Array.isArray(body.keywords) ? body.keywords : [];
  if (keywords.length === 0) {
    return NextResponse.json(
      { ok: false, error: '분석할 키워드를 최소 1개 제공해야 합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (keywords.length > MAX_KEYWORDS_PER_BATCH) {
    return NextResponse.json(
      {
        ok: false,
        error: `한 번에 최대 ${MAX_KEYWORDS_PER_BATCH}개까지만 가능합니다. (요청: ${keywords.length}개)`,
      },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const { batchId, enqueued } = await enqueueBatch({
      companyId: ctx.companyId,
      keywords,
      filterCond: body.filterCond ?? null,
      forceFresh: body.forceFresh === true,
      requestedBy: ctx.userId,
    });
    return NextResponse.json({ ok: true, batchId, enqueued });
  } catch (err) {
    console.error('[api/batch-jobs POST] enqueue 실패:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '큐 등록 실패',
      },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}

const RECENT_BATCH_LIMIT = 10;

export async function GET() {
  const ctx = await requireCompanyContext();
  try {
    const batches = await listRecentBatches(ctx.companyId, RECENT_BATCH_LIMIT);
    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    console.error('[api/batch-jobs GET] 실패:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '조회 실패',
      },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}
