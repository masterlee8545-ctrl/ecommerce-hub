#!/usr/bin/env node
/**
 * 쿠팡 1페이지 리뷰 전체 테이블 출력 (캐시된 키워드용).
 * 사용법: tsx scripts/sello-scraper/show-reviews.ts [keyword1] [keyword2] ...
 * 기본: 러닝벨트 + 바디오일
 */
import { getCoupangFirstPageMetrics } from '../../src/lib/sello-scraper/metrics';

const keywords = process.argv.slice(2);
if (keywords.length === 0) keywords.push('러닝벨트', '바디오일');

(async () => {
  for (const kw of keywords) {
    const m = await getCoupangFirstPageMetrics(kw);
    if (!m) {
      console.log(`\n[${kw}] 캐시 없음 (HUB/BUYWISE 모두 miss)`);
      continue;
    }
    console.log('');
    console.log('━'.repeat(72));
    console.log(
      `[${kw}] source=${m.source} / rowCount=${m.rowCount} / rocketRatio=${(m.rocketRatio * 100).toFixed(1)}%`,
    );
    console.log('━'.repeat(72));
    console.log('rank  rocket   reviews     name');
    console.log('─'.repeat(72));
    for (const r of m.reviews) {
      const rank = String(r.rank).padStart(2, ' ');
      const rocket = r.isRocket ? 'Y(로켓)' : 'N      ';
      const reviews = r.reviewCount.toLocaleString().padStart(9, ' ');
      const name = r.name.slice(0, 45);
      console.log(`  ${rank}   ${rocket}  ${reviews}   ${name}`);
    }
    const total = m.reviews.reduce((s, r) => s + r.reviewCount, 0);
    const rocketTotal = m.reviews.filter((r) => r.isRocket).reduce((s, r) => s + r.reviewCount, 0);
    const normalTotal = total - rocketTotal;
    console.log('─'.repeat(72));
    console.log(
      `총합: ${total.toLocaleString()} 리뷰 (로켓 ${rocketTotal.toLocaleString()} / 일반 ${normalTotal.toLocaleString()})`,
    );
    console.log(`평균: ${Math.round(total / m.rowCount).toLocaleString()} 리뷰/상품`);
  }
})().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
