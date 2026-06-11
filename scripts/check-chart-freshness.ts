import { sql } from 'drizzle-orm';
import { db } from '../src/db';
(async () => {
  const r = await db.execute(sql`
    SELECT keyword, max(period) AS latest, count(*) AS rows
    FROM keyword_chart_daily
    GROUP BY keyword ORDER BY keyword LIMIT 30
  `);
  for (const row of r) {
    console.log(`${row['keyword']}: 최신 ${row['latest']} (${row['rows']} rows)`);
  }
  process.exit(0);
})();
