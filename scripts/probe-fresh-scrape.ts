#!/usr/bin/env node
/**
 * force_fresh=true 로 배치 enqueue 해서 실제 스크래핑 경로 end-to-end 검증.
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { users } from '../src/db/schema';
import { enqueueBatch, listJobsForBatch } from '../src/lib/sello-scraper/job-queue';

const ADMIN_EMAIL = 'admin@buywise.co';
const KEYWORD = process.argv[2] ?? '양말';

(async () => {
  const adminRows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const admin = adminRows[0];
  if (!admin?.active_company_id) throw new Error('admin 없음');
  const companyId = admin.active_company_id;

  console.log(`[probe] 키워드: "${KEYWORD}" force_fresh=true`);
  const { batchId } = await enqueueBatch({
    companyId,
    keywords: [KEYWORD],
    filterCond: { reviewThreshold: 300, minBelowReviewRatio: 0.5 },
    forceFresh: true,
    requestedBy: admin.id,
  });
  console.log(`[probe] enqueued batch=${batchId.slice(0, 8)}`);

  const start = Date.now();
  const MAX_WAIT = 5 * 60 * 1000;
  let last = '';
  while (Date.now() - start < MAX_WAIT) {
    const jobs = await listJobsForBatch(companyId, batchId);
    const j = jobs[0];
    if (!j) {
      console.error('job 사라짐');
      process.exit(1);
    }
    const line = `[${Math.round((Date.now() - start) / 1000)}s] status=${j.status}`
      + (j.cache_hit ? ' (cache)' : '');
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (j.status === 'done') {
      const r = j.result as { rowCount?: number; rocketRatio?: number; priceStats?: { median?: number } } | null;
      console.log(`\n✅ 완료 — rows=${r?.rowCount} rocket=${Math.round((r?.rocketRatio ?? 0) * 100)}% median=₩${r?.priceStats?.median?.toLocaleString('ko-KR') ?? '?'}`);
      process.exit(0);
    }
    if (j.status === 'failed') {
      console.error(`\n❌ 실패: ${j.error}`);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error('타임아웃');
  process.exit(3);
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
