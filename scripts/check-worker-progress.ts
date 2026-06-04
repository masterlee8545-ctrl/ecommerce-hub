import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { scrapeJobs } from '../src/db/schema';

(async () => {
  const rows = await db
    .select({
      status: scrapeJobs.status,
      n: sql<number>`count(*)::int`,
    })
    .from(scrapeJobs)
    .groupBy(scrapeJobs.status);
  console.log('=== 쿠팡 스크래핑 큐 ===');
  for (const r of rows) {
    console.log(`  ${r.status}: ${r.n}개`);
  }
  process.exit(0);
})();
