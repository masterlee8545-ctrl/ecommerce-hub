import { eq, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  // 러닝벨트 + 복숭아 + 풋고추
  const names = ['러닝벨트', '복숭아', '풋고추', '땀패드'];
  for (const name of names) {
    const rows = await db
      .select({
        name: products.name,
        code: products.code,
        monthly_search_volume: products.monthly_search_volume,
        coupang_avg_review_count: products.coupang_avg_review_count,
        coupang_max_review_count: products.coupang_max_review_count,
        season_peak_month: products.season_peak_month,
        season_prep_month: products.season_prep_month,
        seasonality_ratio: products.seasonality_ratio,
        coupang_price_sample_size: products.coupang_price_sample_size,
      })
      .from(products)
      .where(eq(products.name, name));
    for (const r of rows) {
      console.log(`${r.code} ${r.name}:`);
      console.log(`  월검색량=${r.monthly_search_volume}`);
      console.log(`  쿠팡평균리뷰=${r.coupang_avg_review_count}, 최대=${r.coupang_max_review_count}`);
      console.log(`  피크월=${r.season_peak_month}, 준비월=${r.season_prep_month}, 시즌성=${r.seasonality_ratio}`);
      console.log(`  쿠팡샘플=${r.coupang_price_sample_size}`);
    }
  }
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
