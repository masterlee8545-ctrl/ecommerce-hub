import { isNotNull } from 'drizzle-orm';
import { db } from '../src/db';
import { products } from '../src/db/schema';
(async () => {
  const rows = await db
    .select({
      name: products.name,
      growth: products.search_growth_pct,
      low: products.coupang_low_review_count,
      top1: products.coupang_top1_share,
      monthly: products.monthly_search_volume,
    })
    .from(products)
    .where(isNotNull(products.search_growth_pct));
  const sorted = rows
    .map((r) => ({ ...r, g: Number(r.growth) }))
    .sort((a, b) => b.g - a.g);
  console.log(`=== 검색량 성장 TOP 15 (YoY) ===`);
  sorted.slice(0, 15).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.name}: ${r.g > 0 ? '+' : ''}${r.g.toFixed(1)}%  (진입자리 ${r.low ?? '-'}, 1위독점 ${r.top1 ?? '-'}%)`);
  });
  console.log(`\n=== 하락 BOTTOM 10 ===`);
  sorted.slice(-10).reverse().forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.name}: ${r.g.toFixed(1)}%`);
  });
  const pos = sorted.filter((r) => r.g > 0).length;
  const neg = sorted.filter((r) => r.g < 0).length;
  console.log(`\n상승 ${pos} / 하락 ${neg} / 전체 ${sorted.length}`);
  process.exit(0);
})();
