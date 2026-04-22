#!/usr/bin/env node
/**
 * 얇은 래퍼(metrics.ts) 동작 검증용 일회성 스크립트.
 *
 * 사용법: tsx scripts/sello-scraper/verify-cache.ts [keyword]
 * 기본 키워드: "바디오일" (BUYWISE 캐시에 존재함을 가정)
 */
import { getCoupangFirstPageMetrics } from '../../src/lib/sello-scraper/metrics';

const keyword = process.argv[2] ?? '바디오일';

(async () => {
  const result = await getCoupangFirstPageMetrics(keyword);
  if (!result) {
    console.error(`[verify] "${keyword}" 캐시 없음 (HUB/BUYWISE 둘 다 miss)`);
    process.exit(2);
  }
  console.log(`[verify] source=${result.source}`);
  console.log(`[verify] keyword=${result.keyword}`);
  console.log(`[verify] rowCount=${result.rowCount}`);
  console.log(`[verify] rocketRatio=${result.rocketRatio.toFixed(3)}`);
  console.log(`[verify] rocketCount=${result.reviews.filter((r) => r.isRocket).length}`);
  console.log(`[verify] reviews (top 5):`);
  for (const r of result.reviews.slice(0, 5)) {
    console.log(
      `  #${r.rank} rocket=${r.isRocket ? 'Y' : 'N'} reviews=${r.reviewCount.toLocaleString()} — ${r.name.slice(0, 40)}`,
    );
  }
  console.log(`[verify] total reviews sum = ${result.reviews.reduce((s, r) => s + r.reviewCount, 0).toLocaleString()}`);
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
