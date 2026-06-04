/**
 * 추천 엔진 직접 호출 테스트 (API route 없이 로직 검증).
 * 사용: npx tsx --env-file=.env.local scripts/test-recommendations.ts [월]
 */
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import {
  analyzeKeyword,
  getMonthRelevance,
  MONTH_NAMES,
} from '../src/lib/sellochomes/season-analyzer';

async function main() {
  const month = parseInt(process.argv[2] || '5', 10);
  console.log(`타겟월: ${month}월`);

  const startedAt = Date.now();

  const fetched = await db
    .select({ keyword: keywordChartFetches.keyword })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.last_status, 'ok'));

  const keywords = fetched.map((r) => r.keyword);
  console.log(`캐시된 키워드: ${keywords.length}개`);

  // 청크 로드
  const CHUNK = 50;
  const dailyByKeyword = new Map<string, Array<{ period: string; ratio: number }>>();
  for (let i = 0; i < keywords.length; i += CHUNK) {
    const chunk = keywords.slice(i, i + CHUNK);
    const rows = await db
      .select({
        keyword: keywordChartDaily.keyword,
        period: keywordChartDaily.period,
        ratio: keywordChartDaily.ratio,
      })
      .from(keywordChartDaily)
      .where(inArray(keywordChartDaily.keyword, chunk));
    for (const r of rows) {
      if (!dailyByKeyword.has(r.keyword)) dailyByKeyword.set(r.keyword, []);
      dailyByKeyword.get(r.keyword)!.push({ period: r.period, ratio: r.ratio });
    }
  }

  console.log(`데이터 로드 완료 (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

  type Item = {
    keyword: string;
    score: number;
    reason: string;
    seasonality: number;
    peak: number;
    prep: number;
  };

  const items: Item[] = [];
  for (const kw of keywords) {
    const daily = dailyByKeyword.get(kw);
    if (!daily || daily.length === 0) continue;
    const a = analyzeKeyword(kw, daily, { window: 'last_year' });
    if (!a || a.is_evergreen) continue;
    const r = getMonthRelevance(a, month);
    if (r.score === 0) continue;
    items.push({
      keyword: kw,
      score: r.score,
      reason: r.reason,
      seasonality: a.seasonality_ratio,
      peak: a.peak_month,
      prep: a.prep_month,
    });
  }

  // 점수별 그룹
  const groups = {
    now_prep: items.filter((it) => it.score === 5),
    rising: items.filter((it) => it.score === 4),
    peak_soon: items.filter((it) => it.score === 2),
    in_demand: items.filter((it) => it.score === 1),
  };

  const sortByStrength = (a: Item, b: Item) => b.seasonality - a.seasonality;
  groups.now_prep.sort(sortByStrength);
  groups.rising.sort(sortByStrength);
  groups.peak_soon.sort(sortByStrength);
  groups.in_demand.sort(sortByStrength);

  const total = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n총 분석 시간: ${total}s`);
  console.log(`추천 키워드: ${items.length}개`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚨 지금 소싱 시작 (5점) — ${groups.now_prep.length}개`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const it of groups.now_prep.slice(0, 20)) {
    console.log(
      `  ${it.keyword.padEnd(15)} 시즌성 ${it.seasonality.toFixed(1)}x · 피크 ${MONTH_NAMES[it.peak]}`,
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📅 이번달 급상승 (4점) — ${groups.rising.length}개`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const it of groups.rising.slice(0, 20)) {
    console.log(
      `  ${it.keyword.padEnd(15)} 시즌성 ${it.seasonality.toFixed(1)}x · 피크 ${MONTH_NAMES[it.peak]}`,
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⏳ 다음달 피크 (2점) — ${groups.peak_soon.length}개`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const it of groups.peak_soon.slice(0, 10)) {
    console.log(
      `  ${it.keyword.padEnd(15)} 시즌성 ${it.seasonality.toFixed(1)}x · 피크 ${MONTH_NAMES[it.peak]}`,
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📈 진행 중 (1점) — ${groups.in_demand.length}개`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const it of groups.in_demand.slice(0, 10)) {
    console.log(
      `  ${it.keyword.padEnd(15)} 시즌성 ${it.seasonality.toFixed(1)}x · 피크 ${MONTH_NAMES[it.peak]}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
