import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  for (const name of ['러닝벨트', '복숭아']) {
    const [r] = await db
      .select({
        name: products.name,
        low: products.coupang_low_review_count,
        sample: products.coupang_price_sample_size,
        avg: products.coupang_avg_review_count,
        max: products.coupang_max_review_count,
      })
      .from(products)
      .where(eq(products.name, name));
    if (r) console.log(`${r.name}: 리뷰 300이하 ${r.low}/${r.sample}개, 평균 ${r.avg}, 최대 ${r.max}`);
  }
  process.exit(0);
})();
