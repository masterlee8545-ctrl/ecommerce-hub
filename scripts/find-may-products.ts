#!/usr/bin/env node
/**
 * 5월 준비할 농산물/수산물 자동 발굴 + 농가 매칭 (이재홍 대표용 통합 보고서)
 *
 * 흐름:
 *   1. 시즌 펄스 데이터 로드 (DB 캐시된 549개 키워드)
 *   2. 각 키워드 분석 → 5월 기준 5점/4점 그룹 추출
 *   3. 농산물 키워드만 필터 (1차 농산물 사전)
 *   4. 각 키워드별로 농가 매칭 (DB 의 1,835명 풀)
 *   5. 마크다운 보고서 출력
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/find-may-products.ts > may-products-report.md
 */
import { eq, inArray } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';
import { PRIMARY_PRODUCT_LABELS, extractAllKeywords } from '../src/lib/vendors/keywords';
import { matchVendorsForProduct, type MatchResult } from '../src/lib/vendors/match';

const TARGET_MONTH = 5; // 5월
const CHUNK_SIZE = 50;

interface RecommendationItem {
  keyword: string;
  score: number; // 5/4/2/1
  reason: string;
  caution: string;
  peakMonth: number | undefined;
  prepMonth: number | undefined;
  seasonalityRatio: number;
  isAgricultural: boolean; // 1차 농산물 키워드 매칭 여부
  matchedLabels: string[]; // 매칭된 1차 농산물 라벨
  vendors: Array<{
    bizName: string;
    score: number;
    phone: string | null;
    address: string | null;
    sourceSite: string;
    reasons: string[];
  }>;
}

(async () => {
  console.log('[probe] === 5월 준비 농산물/수산물 자동 발굴 시작 ===\n');

  // 회사 컨텍스트 (유어밸류 — agricultural)
  const companyRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'agricultural'));
  const company = companyRows[0];
  if (!company) {
    console.error('agricultural 회사 없음');
    process.exit(1);
  }
  console.log(`회사: ${company.name}\n`);

  // 1) 시즌 분석 데이터 로드
  const fetched = await db
    .select({ keyword: keywordChartFetches.keyword })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.last_status, 'ok'));
  const keywords = fetched.map((r) => r.keyword);
  console.log(`분석 대상 키워드: ${keywords.length}개\n`);

  // 2) 일별 데이터 청크 로드
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

  // 3) 5월 기준 5점/4점 그룹 추출 + 농산물 필터
  const items: RecommendationItem[] = [];
  for (const keyword of keywords) {
    const daily = dailyByKeyword.get(keyword);
    if (!daily || daily.length === 0) continue;

    const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
    if (!analysis) continue;

    const rel = getMonthRelevance(analysis, TARGET_MONTH);
    if (rel.score < 4) continue; // 4점 이상만 (5월 직접 관련)

    // 1차 농산물 키워드 매칭 검사
    const { combined: labels } = extractAllKeywords(keyword);
    const agriLabels = labels.filter((l) => PRIMARY_PRODUCT_LABELS.has(l));

    items.push({
      keyword,
      score: rel.score,
      reason: rel.reason,
      caution: rel.caution ?? '',
      peakMonth: analysis.peak_month,
      prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio ?? 0,
      isAgricultural: agriLabels.length > 0,
      matchedLabels: agriLabels,
      vendors: [],
    });
  }

  // 농산물만 (시즌 점수 ≥ 4 AND 1차 농산물 키워드 매칭)
  const agriItems = items
    .filter((i) => i.isAgricultural)
    .sort((a, b) => {
      // 5점 우선, 같으면 시즌성 배수
      if (a.score !== b.score) return b.score - a.score;
      return b.seasonalityRatio - a.seasonalityRatio;
    });

  console.log(`5월 관련 농산물 후보 (시즌 점수 ≥ 4 + 1차 농산물 매칭): ${agriItems.length}개\n`);

  // 4) 각 키워드별 농가 매칭 (상위 15개만)
  const topItems = agriItems.slice(0, 15);
  for (const item of topItems) {
    const matches = await withCompanyContext(company.id, async (tx) =>
      matchVendorsForProduct(tx, {
        productName: item.keyword,
        seasonPeakMonth: item.peakMonth ?? null,
        seasonPrepMonth: item.prepMonth ?? null,
        limit: 5,
      }),
    );
    item.vendors = matches.map((m: MatchResult) => ({
      bizName: m.vendor.biz_name,
      score: m.score,
      phone: m.vendor.repr_tel_no ?? m.vendor.biz_mobile,
      address: m.vendor.biz_address,
      sourceSite: m.vendor.source_site,
      reasons: m.reasons,
    }));
  }

  // 5) 마크다운 보고서 출력
  console.log('\n\n===== 마크다운 보고서 =====\n');
  console.log('# 🌾 5월 준비 농산물/수산물 추천 — 자동 발굴 보고서\n');
  console.log(`**분석 기준**: 5월 / 시즌 점수 ≥ 4점 / 1차 농산물 매칭 / 농가 풀 1,835명\n`);
  console.log(`**총 후보**: ${topItems.length}개 (상위 15개)\n`);
  console.log('---\n');

  topItems.forEach((item, i) => {
    console.log(`## ${i + 1}. **${item.keyword}** — 시즌 점수 ${item.score}점 ⭐`);
    console.log(``);
    console.log(`### 왜 이 상품?`);
    console.log(`- **${item.reason}**`);
    if (item.caution) console.log(`- ⚠️ ${item.caution}`);
    console.log(`- 작년 피크: **${item.peakMonth ?? '?'}월** / 준비 시작: **${item.prepMonth ?? '?'}월**`);
    console.log(`- 시즌성 배수: **${(item.seasonalityRatio ?? 0).toFixed(1)}배** (피크/바닥)`);
    console.log(`- 매칭된 농산물: ${item.matchedLabels.join(', ')}`);
    console.log(``);
    console.log(`### 매칭 농가 (${item.vendors.length}곳)`);
    if (item.vendors.length === 0) {
      console.log(`> 매칭된 농가 없음 — DB 에 해당 품목 농가가 등록 안 됨`);
    } else {
      console.log(`| 점수 | 농가 | ☎ 연락처 | 주소 | 출처 |`);
      console.log(`|---|---|---|---|---|`);
      item.vendors.forEach((v) => {
        const phone = v.phone || '-';
        const addr = (v.address ?? '').slice(0, 30);
        console.log(`| ${v.score}점 | **${v.bizName}** | \`${phone}\` | ${addr} | ${v.sourceSite} |`);
      });
    }
    console.log(``);
    console.log(`---\n`);
  });

  // 6) 요약 JSON (이커머스허브 등록용)
  console.log('\n===== 등록용 JSON =====\n');
  console.log('```json');
  console.log(
    JSON.stringify(
      topItems.map((i) => ({
        keyword: i.keyword,
        supply_type: 'domestic_vendor',
        season_score: i.score,
        season_peak_month: i.peakMonth,
        season_prep_month: i.prepMonth,
        seasonality_ratio: (i.seasonalityRatio ?? 0).toFixed(2),
        suggested_vendors: i.vendors.slice(0, 3).map((v) => ({
          name: v.bizName,
          phone: v.phone,
        })),
      })),
      null,
      2,
    ),
  );
  console.log('```');

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
