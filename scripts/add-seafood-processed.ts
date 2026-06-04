#!/usr/bin/env node
/**
 * 수산물 + 로컬 가공식품 발굴 + 등록
 *
 * 형 비즈니스 원칙: "로켓 없는 카테고리 = 진입 기회"
 *
 * 처리:
 *   1. 시즌 펄스 풀의 수산물/김치/한과 19개 → 시즌 점수 4점 이상 자동 등록
 *   2. 형 도메인 큐레이션 키워드 추가 (자반고등어, 굴비 등 — 시즌 점수 없어도 진입 가치)
 *   3. 정규식 수정 — 로컬 가공식품 (김치/한과/장아찌/자반) 허용
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, keywordChartDaily, keywordChartFetches, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';

const TARGET_MONTH = 5;

// ─────────────────────────────────────────────────────────
// 1. 시즌 펄스 풀에서 추출할 키워드 (수산물 + 가공식품)
// ─────────────────────────────────────────────────────────
const SEASONAL_KEYWORDS = [
  '갈치', '건오징어', '고등어', '김', '낙지', '다시마', '멸치', '문어',
  '미역', '삼치', '새우', '오징어',
  '김치', '깍두기', '장아찌', '젓갈',
  '약과', '한과',
  '벌꿀',
];

// ─────────────────────────────────────────────────────────
// 2. 형 도메인 큐레이션 — 로켓 없는 진입 기회 카테고리
//    시즌 점수 없어도 등록 (1년 내내 수요 + 농가/어가 직거래)
// ─────────────────────────────────────────────────────────
interface CuratedItem {
  name: string;
  category: string;
  note: string;
}

const CURATED: CuratedItem[] = [
  // 자반/건어물
  { name: '자반고등어', category: '수산가공', note: '농가/어가 위탁 가능, 쿠팡 로켓 적음, 진입 기회' },
  { name: '자반갈치', category: '수산가공', note: '로켓 없는 가공 수산물' },
  { name: '굴비', category: '수산가공', note: '영광 굴비 등 지역 특산, 로켓 X' },
  { name: '보리굴비', category: '수산가공', note: '고급 수산가공, 단가 ↑ 마진 ↑' },
  { name: '진미채', category: '수산가공', note: '오징어 가공, 1688 가능' },
  { name: '마른멸치', category: '수산가공', note: '국산/수입 분기 가능' },
  { name: '마른새우', category: '수산가공', note: '건어물' },
  { name: '마른오징어', category: '수산가공', note: '건어물' },
  { name: '황태채', category: '수산가공', note: '북어 가공' },
  { name: '북어', category: '수산가공', note: '명태 건제품' },
  { name: '김자반', category: '수산가공', note: '김 가공' },
  { name: '조미김', category: '수산가공', note: '김 가공' },
  { name: '다시팩', category: '수산가공', note: '멸치+다시마 티백' },

  // 젓갈/김치
  { name: '명란젓', category: '젓갈', note: '명란 가공' },
  { name: '새우젓', category: '젓갈', note: '김장 부재료' },
  { name: '갓김치', category: '김치', note: '여수 갓김치 등 지역 특산' },
  { name: '묵은지', category: '김치', note: '숙성 김치' },
  { name: '포기김치', category: '김치', note: '배추김치' },
  { name: '열무김치', category: '김치', note: '여름 시즌' },
  { name: '깻잎장아찌', category: '장아찌', note: '농가 가공' },
  { name: '매실장아찌', category: '장아찌', note: '농가 가공' },
];

(async () => {
  const agriRows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const agriCo = agriRows[0]!;
  console.log(`회사: ${agriCo.name}\n`);

  // ─── 1) 시즌 펄스에서 시즌 점수 4점 이상 자동 추출 ───
  console.log('=== 시즌 펄스 키워드 시즌 분석 ===');
  const dailyByKeyword = new Map<string, Array<{ period: string; ratio: number }>>();
  const rows = await db
    .select({ keyword: keywordChartDaily.keyword, period: keywordChartDaily.period, ratio: keywordChartDaily.ratio })
    .from(keywordChartDaily)
    .where(inArray(keywordChartDaily.keyword, SEASONAL_KEYWORDS));
  for (const r of rows) {
    if (!dailyByKeyword.has(r.keyword)) dailyByKeyword.set(r.keyword, []);
    dailyByKeyword.get(r.keyword)!.push({ period: r.period, ratio: r.ratio });
  }

  interface SeasonItem {
    keyword: string; score: number; peakMonth: number; prepMonth: number; seasonalityRatio: number;
  }
  const seasonalItems: SeasonItem[] = [];
  for (const keyword of SEASONAL_KEYWORDS) {
    const daily = dailyByKeyword.get(keyword);
    if (!daily) continue;
    const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
    if (!analysis) continue;
    const rel = getMonthRelevance(analysis, TARGET_MONTH);
    if (rel.score < 4) continue;
    seasonalItems.push({
      keyword, score: rel.score, peakMonth: analysis.peak_month, prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio,
    });
  }
  seasonalItems.sort((a, b) => b.score - a.score || b.seasonalityRatio - a.seasonalityRatio);
  console.log(`  시즌 4점 이상: ${seasonalItems.length}개`);

  // ─── 2) 기존 등록 키워드 확인 ───
  const existing = await db.select({ name: products.name }).from(products).where(eq(products.status, 'research'));
  const existingNames = new Set(existing.map((p) => p.name));
  console.log(`  현재 등록: ${existingNames.size}개\n`);

  // ─── 3) 시즌 키워드 등록 (중복 제외) ───
  console.log('=== 시즌 펄스 수산물/가공식품 등록 ===');
  let registered = 0;
  for (const item of seasonalItems) {
    if (existingNames.has(item.keyword)) {
      console.log(`  ⏭ 이미 등록됨: ${item.keyword}`);
      continue;
    }
    const code = await suggestNextProductCode(agriCo.id);
    await withCompanyContext(agriCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: agriCo.id, code, name: item.keyword, category: '수산물',
        status: 'research',
        description: `시즌 점수 ${item.score}점, ${item.seasonalityRatio.toFixed(1)}배. 자동 발굴.`,
        supply_type: 'domestic_vendor',
        season_peak_month: item.peakMonth || null,
        season_prep_month: item.prepMonth || null,
        seasonality_ratio: item.seasonalityRatio.toString(),
        season_score: item.score,
      });
    });
    console.log(`  ✅ ${code} ${item.keyword} (${item.score}점, ${item.seasonalityRatio.toFixed(1)}배)`);
    registered++;
  }

  // ─── 4) 큐레이션 키워드 등록 ───
  console.log('\n=== 형 도메인 큐레이션 (로켓 없는 카테고리) 등록 ===');
  let curatedRegistered = 0;
  for (const c of CURATED) {
    if (existingNames.has(c.name)) {
      console.log(`  ⏭ 이미 등록됨: ${c.name}`);
      continue;
    }
    const code = await suggestNextProductCode(agriCo.id);
    await withCompanyContext(agriCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: agriCo.id, code, name: c.name, category: c.category,
        status: 'research',
        description: `[큐레이션] ${c.note}. 시즌 분석 데이터 없음 (상시 진입 카테고리).`,
        supply_type: 'domestic_vendor',
        season_score: null,
      });
    });
    console.log(`  ✅ ${code} ${c.name} (${c.category}) — ${c.note}`);
    curatedRegistered++;
  }

  console.log('\n=== 통계 ===');
  console.log(`  시즌 등록: ${registered}개`);
  console.log(`  큐레이션: ${curatedRegistered}개`);
  console.log(`  합계 신규: ${registered + curatedRegistered}개`);
  const [total] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, 'research'));
  console.log(`  총 등록 상품: ${total?.c ?? 0}개`);

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
