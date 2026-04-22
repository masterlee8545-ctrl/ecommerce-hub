#!/usr/bin/env node
/**
 * getCoupangFirstPageMetrics 확장 필드 (가격·썸네일·URL·월판매) 존재 여부 확인.
 */
import { getCoupangFirstPageMetrics } from '../src/lib/sello-scraper/metrics';

const keyword = process.argv[2] ?? '러닝벨트';

(async () => {
  const m = await getCoupangFirstPageMetrics(keyword);
  if (!m) {
    console.error(`[probe] "${keyword}" 캐시 없음`);
    process.exit(2);
  }

  console.log(`[probe] ${m.keyword} | ${m.rowCount}개 | source=${m.source}`);
  console.log(`[probe] rocketRatio=${(m.rocketRatio * 100).toFixed(0)}%`);
  console.log(`[probe] priceStats:`, m.priceStats);

  let priceOk = 0, imgOk = 0, urlOk = 0, salesOk = 0;
  for (const r of m.reviews) {
    if (r.price !== null) priceOk++;
    if (r.imageUrl !== null) imgOk++;
    if (r.productUrl !== null) urlOk++;
    if (r.monthlySales !== null) salesOk++;
  }
  console.log(`[probe] 필드 채움:`);
  console.log(`  - price:        ${priceOk}/${m.rowCount}`);
  console.log(`  - imageUrl:     ${imgOk}/${m.rowCount}`);
  console.log(`  - productUrl:   ${urlOk}/${m.rowCount}`);
  console.log(`  - monthlySales: ${salesOk}/${m.rowCount}`);

  console.log(`\n[probe] top 3 샘플:`);
  for (const r of m.reviews.slice(0, 3)) {
    console.log(
      `  #${r.rank} ₩${r.price?.toLocaleString('ko-KR') ?? '?'}  리뷰=${r.reviewCount.toLocaleString()}  판매=${r.monthlySales?.toLocaleString('ko-KR') ?? '?'}  ${r.imageUrl ? '📷' : '  '}  ${r.productUrl ? '🔗' : '  '}  ${r.name.slice(0, 35)}`,
    );
  }
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
