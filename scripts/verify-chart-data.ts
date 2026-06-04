/**
 * 시즌 분석 검증 스크립트.
 * 사용: npx tsx --env-file=.env.local scripts/verify-chart-data.ts [키워드]
 */
import { eq, count } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import {
  analyzeKeyword,
  buildLastYearMonthlyChart,
} from '../src/lib/sellochomes/season-analyzer';

async function main() {
  const keyword = process.argv[2] || 'CLA';

  const cnt = await db
    .select({ c: count() })
    .from(keywordChartDaily)
    .where(eq(keywordChartDaily.keyword, keyword));
  console.log(`${keyword} 일별 row 수:`, cnt[0]?.c);

  const meta = await db
    .select()
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.keyword, keyword));
  if (meta[0]) {
    console.log(
      `Fetch: status=${meta[0].last_status}, 기간=${meta[0].data_start_date}~${meta[0].data_end_date}`,
    );
  } else {
    console.log('Fetch 기록 없음');
    process.exit(0);
  }

  const rows = await db
    .select({
      period: keywordChartDaily.period,
      ratio: keywordChartDaily.ratio,
    })
    .from(keywordChartDaily)
    .where(eq(keywordChartDaily.keyword, keyword));

  console.log('\n=== 시즌 분석 (작년 1년) ===');
  const analysis = analyzeKeyword(keyword, rows);
  if (analysis) {
    console.log(`  피크월: ${analysis.peak_month}월`);
    console.log(`  상승월: ${analysis.rise_month}월`);
    console.log(`  준비월: ${analysis.prep_month}월`);
    console.log(`  수요기간: ${analysis.demand_period}`);
    console.log(`  시즌성 배수: ${analysis.seasonality_ratio}x`);
    console.log(`  상시여부: ${analysis.is_evergreen ? '상시' : '시즌'}`);
    console.log(`  데이터 품질: ${analysis.data_quality}`);
  } else {
    console.log('  (분석 불가 — 데이터 없음)');
  }

  console.log('\n=== 작년 12개월 막대그래프 ===');
  const chart = buildLastYearMonthlyChart(rows);
  for (const c of chart) {
    const barLen = Math.max(0, Math.round(c.ratio / 2));
    const bar = '#'.repeat(barLen);
    console.log(`  ${c.label.padEnd(4)} ${bar.padEnd(50)} ${c.ratio.toFixed(1)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
