import { getCoupangFirstPageMetrics } from '../src/lib/sello-scraper/metrics';

(async () => {
  const queries = ['운동화 빨래망', '운동화빨래망', '신발 빨래망', '운동화 세탁망'];
  for (const q of queries) {
    const m = await getCoupangFirstPageMetrics(q);
    if (!m) {
      console.log(`"${q}" — 캐시 없음`);
      continue;
    }
    const reviews = m.reviews.map((r) => r.reviewCount);
    const avg = Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length);
    const max = Math.max(...reviews);
    const min = Math.min(...reviews);
    console.log(`"${q}" — 평균 리뷰 ${avg} / 최대 ${max} / 최소 ${min} / 로켓 ${Math.round(m.rocketRatio * 100)}%`);
    console.log('  상위 3개:');
    m.reviews.slice(0, 3).forEach((r) => {
      console.log(`    [${r.rank}위] ${r.isRocket ? '🚀' : '  '} 리뷰 ${r.reviewCount} | ${r.name.slice(0, 50)}`);
    });
  }
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
