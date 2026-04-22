#!/usr/bin/env node
/**
 * 배치 분석 큐 end-to-end 테스트.
 *
 * 순서:
 * 1. enqueueBatch() 로 3개 키워드 등록 (사과·복숭아 캐시됨 + 신규 1개)
 * 2. 몇 초 간격으로 listJobsForBatch() 상태 확인 (워커가 실행 중이어야 함)
 * 3. 모두 done 되면 결과 요약
 *
 * 전제:
 * - 다른 터미널에서 `npm run sello:worker` 실행 중
 * - .env.local 세팅 완료
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { users } from '../src/db/schema';
import {
  enqueueBatch,
  listJobsForBatch,
} from '../src/lib/sello-scraper/job-queue';

const ADMIN_EMAIL = 'admin@buywise.co';
const KEYWORDS = process.argv.slice(2);
const DEFAULT_KEYWORDS = ['사과', '복숭아', '수박'];

const POLL_EVERY_MS = 3_000;
const MAX_WAIT_MS = 10 * 60 * 1000; // 10분

async function main(): Promise<void> {
  const keywords = KEYWORDS.length > 0 ? KEYWORDS : DEFAULT_KEYWORDS;
  console.log(`[test] keywords: ${keywords.join(', ')}`);

  // admin 유저 + 첫 법인 조회
  const adminRows = await db
    .select()
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);
  const admin = adminRows[0];
  if (!admin) throw new Error('admin@buywise.co 사용자가 없습니다. seed 필요.');
  const companyId = admin.active_company_id;
  if (!companyId) throw new Error('active_company_id 가 없습니다.');

  console.log(`[test] admin=${admin.id.slice(0, 8)} company=${companyId.slice(0, 8)}`);

  // enqueue
  const { batchId, enqueued } = await enqueueBatch({
    companyId,
    keywords,
    filterCond: {
      reviewThreshold: 300,
      minBelowReviewRatio: 0.5,
    },
    forceFresh: false,
    requestedBy: admin.id,
  });
  console.log(`[test] enqueued: batchId=${batchId.slice(0, 8)} count=${enqueued}\n`);

  // polling
  const startedAt = Date.now();
  let lastSummary = '';
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const jobs = await listJobsForBatch(companyId, batchId);
    const summary = {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      running: jobs.filter((j) => j.status === 'running').length,
      done: jobs.filter((j) => j.status === 'done').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      cancelled: jobs.filter((j) => j.status === 'cancelled').length,
    };
    const summaryStr = `pending=${summary.pending} running=${summary.running} done=${summary.done} failed=${summary.failed}`;
    if (summaryStr !== lastSummary) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[test] [${elapsed}s] ${summaryStr}`);
      for (const job of jobs) {
        if (job.status === 'running' || job.status === 'done' || job.status === 'failed') {
          const icon = job.status === 'done' ? '✅' : job.status === 'failed' ? '❌' : '⏳';
          const extra = job.cache_hit ? ' (cache)' : '';
          const err = job.error ? ` err="${job.error.slice(0, 50)}"` : '';
          console.log(`       ${icon} ${job.keyword.padEnd(15)} ${job.status}${extra}${err}`);
        }
      }
      lastSummary = summaryStr;
    }

    const activeCount = summary.pending + summary.running;
    if (activeCount === 0) {
      console.log(`\n[test] 전부 완료 — 총 ${Math.round((Date.now() - startedAt) / 1000)}s`);
      // 최종 요약
      for (const j of jobs) {
        const m = j.result as { rowCount?: number; rocketRatio?: number; priceStats?: { median?: number } } | null;
        if (j.status === 'done' && m) {
          console.log(
            `  ${j.keyword}: rows=${m.rowCount} rocket=${Math.round((m.rocketRatio ?? 0) * 100)}% median=₩${m.priceStats?.median?.toLocaleString('ko-KR') ?? '?'}`,
          );
        } else if (j.status === 'failed') {
          console.log(`  ${j.keyword}: FAILED — ${j.error}`);
        }
      }
      process.exit(0);
    }

    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
  }

  console.error('[test] 타임아웃 — 워커가 처리 못했을 수 있음');
  process.exit(2);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
