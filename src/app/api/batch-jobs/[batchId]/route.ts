/**
 * /api/batch-jobs/<batchId> — 특정 배치의 job 상태·결과 폴링
 *
 * GET:    해당 batchId 의 모든 job 반환 (UI 가 2~3초 주기로 폴링)
 * DELETE: pending 상태 job 들을 cancelled 로 전환 (배치 취소)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireCompanyContext } from '@/lib/auth/session';
import { cancelBatch, listJobsForBatch } from '@/lib/sello-scraper/job-queue';

const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Params {
  params: Promise<{ batchId: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await requireCompanyContext();
  const { batchId } = await params;

  try {
    const jobs = await listJobsForBatch(ctx.companyId, batchId);
    if (jobs.length === 0) {
      return NextResponse.json(
        { ok: false, error: '해당 배치를 찾을 수 없습니다.' },
        { status: HTTP_NOT_FOUND },
      );
    }

    // 집계
    const summary = {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      running: jobs.filter((j) => j.status === 'running').length,
      done: jobs.filter((j) => j.status === 'done').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      cancelled: jobs.filter((j) => j.status === 'cancelled').length,
    };

    return NextResponse.json({ ok: true, batchId, summary, jobs });
  } catch (err) {
    console.error('[api/batch-jobs/:id GET] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await requireCompanyContext();
  const { batchId } = await params;

  try {
    const cancelled = await cancelBatch(ctx.companyId, batchId);
    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    console.error('[api/batch-jobs/:id DELETE] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '취소 실패' },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}
