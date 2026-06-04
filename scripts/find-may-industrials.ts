#!/usr/bin/env node
/**
 * 5월 준비 공산품 발굴 — 시즌 펄스에서 농산물 아닌 키워드 추출
 *
 * 흐름:
 *   1. 시즌 펄스 데이터 로드
 *   2. 5월 시즌 점수 4점 이상
 *   3. 1차 농산물 키워드 미매칭 (공산품)
 *   4. 시즌성 배수 + 검색량 추정으로 정렬
 */
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';
import { PRIMARY_PRODUCT_LABELS, extractAllKeywords } from '../src/lib/vendors/keywords';

const TARGET_MONTH = 5;
const CHUNK_SIZE = 50;

interface Item {
  keyword: string;
  score: number;
  reason: string;
  caution: string;
  peakMonth: number | undefined;
  prepMonth: number | undefined;
  seasonalityRatio: number;
}

(async () => {
  const fetched = await db
    .select({ keyword: keywordChartFetches.keyword })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.last_status, 'ok'));
  const keywords = fetched.map((r) => r.keyword);

  const dailyByKeyword = new Map<string, Array<{ period: string; ratio: number }>>();
  for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
    const chunk = keywords.slice(i, i + CHUNK_SIZE);
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

  const items: Item[] = [];
  for (const keyword of keywords) {
    const daily = dailyByKeyword.get(keyword);
    if (!daily || daily.length === 0) continue;

    const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
    if (!analysis) continue;
    const rel = getMonthRelevance(analysis, TARGET_MONTH);
    if (rel.score < 4) continue;

    // 1차 농산물 매칭 검사
    const { combined: labels } = extractAllKeywords(keyword);
    const agriLabels = labels.filter((l) => PRIMARY_PRODUCT_LABELS.has(l));
    if (agriLabels.length > 0) continue; // 농산물 제외

    // 가공품 라벨도 제외 (장, 떡/빵, 누룽지 등)
    if (labels.length > 0 && !agriLabels.length) {
      // labels 에 가공품만 있는 경우 — 그래도 농산물 연관이라 제외
      // 단 차/즙 같은 일부 가공품은 공산품 분류 모호 — 일단 제외
      continue;
    }

    items.push({
      keyword,
      score: rel.score,
      reason: rel.reason,
      caution: rel.caution ?? '',
      peakMonth: analysis.peak_month,
      prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio ?? 0,
    });
  }

  // 정렬: 5점 > 4점, 같으면 시즌성 배수 큰 순
  items.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.seasonalityRatio - a.seasonalityRatio;
  });

  console.log(`# 5월 공산품 후보 (시즌 점수 ≥ 4): ${items.length}개\n`);
  items.slice(0, 25).forEach((item, i) => {
    console.log(`${i + 1}. **${item.keyword}** (${item.score}점) — 피크 ${item.peakMonth ?? '?'}월 / 시즌성 ${item.seasonalityRatio.toFixed(1)}배`);
    console.log(`   ${item.reason}`);
  });

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
