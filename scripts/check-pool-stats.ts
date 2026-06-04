/** 키워드 풀 + DB 캐시 상태 통계. */
import { count, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';

async function main() {
  const daily = await db.select({ c: count() }).from(keywordChartDaily);
  const fetches = await db.select({ c: count() }).from(keywordChartFetches);

  console.log('keyword_chart_daily 일별 row:', daily[0]?.c.toLocaleString());
  console.log('keyword_chart_fetches 키워드 수:', fetches[0]?.c.toLocaleString());

  const byStatus = await db
    .select({
      status: keywordChartFetches.last_status,
      cnt: count(),
    })
    .from(keywordChartFetches)
    .groupBy(keywordChartFetches.last_status);

  console.log('\n상태별:');
  for (const row of byStatus) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  // 데이터 풍부한 상위 10개 (point_count 기준)
  const top = await db
    .select()
    .from(keywordChartFetches)
    .orderBy(sql`point_count DESC`)
    .limit(10);

  console.log('\n데이터 풍부 TOP 10:');
  for (const r of top) {
    console.log(`  ${r.keyword.padEnd(15)} ${r.point_count.toLocaleString().padStart(6)}개  ${r.data_start_date}~${r.data_end_date}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
