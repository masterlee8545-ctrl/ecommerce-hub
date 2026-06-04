/**
 * fill 작업 결과 — 채워진 상품 vs 미채워진 상품
 */
import { eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  const filled = await db
    .select({
      code: products.code,
      name: products.name,
      monthly: products.monthly_search_volume,
      lowReview: products.coupang_low_review_count,
      sampleSize: products.coupang_price_sample_size,
      median: products.coupang_price_median,
    })
    .from(products)
    .where(isNotNull(products.market_prices_updated_at))
    .orderBy(products.market_prices_updated_at);

  console.log(`=== 채워진 상품 ${filled.length}개 ===\n`);
  for (const p of filled) {
    const m = p.monthly ? p.monthly.toLocaleString() : '-';
    const lr = p.lowReview ?? '-';
    const med = p.median ? `${parseInt(p.median).toLocaleString()}원` : '-';
    console.log(
      `  ${p.code} ${p.name}: 네이버${m}/월, 리뷰<300 ${lr}/${p.sampleSize ?? '-'}, 중간가 ${med}`,
    );
  }

  const total = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, 'research'));
  console.log(`\n전체 research 상품: ${total[0]?.n ?? 0}개`);
  console.log(`채워진 비율: ${filled.length}/${total[0]?.n ?? 0}`);
  process.exit(0);
})();
