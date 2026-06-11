import { isNotNull, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { products } from '../src/db/schema';
(async () => {
  const rows = await db
    .select({
      name: products.name,
      top1: products.coupang_top1_share,
      top3: products.coupang_top3_share,
      growth: products.search_growth_pct,
      low: products.coupang_low_review_count,
    })
    .from(products)
    .where(isNotNull(products.coupang_top1_share))
    .limit(12);
  console.log('독점도 채워진 상품:');
  for (const r of rows) {
    console.log(`  ${r.name}: 1위 ${r.top1}% / 상위3 ${r.top3}% / 성장 ${r.growth ?? '-'}% / 진입자리 ${r.low}`);
  }
  const counts = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE coupang_top1_share IS NOT NULL) AS top1,
      count(*) FILTER (WHERE search_growth_pct IS NOT NULL) AS growth,
      count(*) FILTER (WHERE coupang_ad_count IS NOT NULL) AS ads
    FROM products
  `);
  console.log('채움 현황:', JSON.stringify(counts[0]));
  process.exit(0);
})();
