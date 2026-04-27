import { desc, eq } from 'drizzle-orm';
import { db } from '../src/db';
import { scrapeJobs } from '../src/db/schema';

(async () => {
  // 최근 단백질쉐이크 키워드 job 조회 (최신순 5개) — company_id 도 확인
  const rows = await db
    .select({
      id: scrapeJobs.id,
      batch_id: scrapeJobs.batch_id,
      keyword: scrapeJobs.keyword,
      status: scrapeJobs.status,
      company_id: scrapeJobs.company_id,
      worker_id: scrapeJobs.worker_id,
      requested_at: scrapeJobs.requested_at,
      started_at: scrapeJobs.started_at,
      last_heartbeat_at: scrapeJobs.last_heartbeat_at,
      completed_at: scrapeJobs.completed_at,
      cache_hit: scrapeJobs.cache_hit,
    })
    .from(scrapeJobs)
    .where(eq(scrapeJobs.keyword, '단백질쉐이크'))
    .orderBy(desc(scrapeJobs.requested_at))
    .limit(5);

  console.log(`찾은 job: ${rows.length}개`);
  for (const r of rows) {
    console.log('─────────────────────────');
    console.log(JSON.stringify(r, null, 2));
  }
  process.exit(0);
})();
