import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { scrapeJobs } from '../src/db/schema';

(async () => {
  // failed → pending 으로 reset
  const updated = await db
    .update(scrapeJobs)
    .set({
      status: 'pending',
      result: null,
      error_message: null,
      claimed_at: null,
      claimed_by: null,
      heartbeat_at: null,
      attempt_count: 0,
    })
    .where(eq(scrapeJobs.status, 'failed'))
    .returning({ id: scrapeJobs.id });

  console.log(`${updated.length}개 재시도 큐로 복귀`);

  const counts = await db
    .select({
      status: scrapeJobs.status,
      n: sql<number>`count(*)::int`,
    })
    .from(scrapeJobs)
    .groupBy(scrapeJobs.status);
  for (const c of counts) console.log(`  ${c.status}: ${c.n}`);

  process.exit(0);
})();
