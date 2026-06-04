#!/usr/bin/env node
/**
 * 5월 대량 상품 발굴 + 자동 등록 (이재홍 대표 기준 반영)
 *
 * 기준:
 *   - 시즌 펄스 4~5점 키워드 (현재 시즌 + 다가오는 피크)
 *   - 객단가 1만~10만원 (자동 판단 안 됨 — 키워드만 추천)
 *   - 마진: 공산품 50%+ / 농산물 20~30% (목표)
 *   - 제외: 화장품/의류/영양제/건기식/가전/명품
 *   - 농산물 → 유어밸류 / 공산품 → 바이와이즈
 *
 * 처리:
 *   1. 시즌 펄스 키워드 분석 → 4점 이상
 *   2. 제외 카테고리 필터 (정규식)
 *   3. 농산물 vs 공산품 분류
 *   4. 시즌성 + 시즌 점수로 정렬
 *   5. 30개 자동 등록 (이미 등록된 키워드는 스킵)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';
import { PRIMARY_PRODUCT_LABELS, extractAllKeywords } from '../src/lib/vendors/keywords';
import { matchVendorsForProduct, type MatchResult } from '../src/lib/vendors/match';

const TARGET_MONTH = 5;
const TARGET_COUNT = 30;
const MIN_SCORE = 4;
const CHUNK_SIZE = 50;

// ─────────────────────────────────────────────────────────
// 제외 카테고리 정규식 (형 기준)
// ─────────────────────────────────────────────────────────

const EXCLUDE_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  // 화장품
  {
    category: '화장품',
    pattern:
      /화장품|로션|크림|세럼|토너|에센스|미스트|마스카라|아이라이너|아이섀도|립스틱|블러셔|컨실러|쿠션|파운데이션|선크림|선스틱|샴푸|린스|트리트먼트|헤어팩|헤어\s*에센스|두피\s*샴푸|미백|미백크림|메이크업|네일|매니큐어|향수|퍼퓸|코롱|디퓨저|향초/,
  },
  // 의류
  {
    category: '의류',
    pattern:
      /원피스|티셔츠|셔츠|블라우스|니트|가디건|스웨터|자켓|점퍼|패딩|코트|청바지|진(?!액|짜)|바지|레깅스|치마|스커트|수영복|비키니|레쉬가드|등산복|러닝화|운동화|스니커즈|로퍼|구두|샌들|슬리퍼|부츠|양말|스타킹|속옷|브라|팬티/,
  },
  // 영양제 / 건기식
  {
    category: '영양제/건기식',
    pattern:
      /영양제|건강기능|비타민|오메가|콜라겐|프로바이오틱스|유산균|루테인|밀크씨슬|글루타치온|마그네슘|칼슘|아연|철분|코엔자임|타우린|크레아틴|단백질\s*보충제|프로틴/,
  },
  // 가전
  {
    category: '가전',
    pattern:
      /tv|텔레비전|냉장고|세탁기|건조기|에어컨|공기청정기|선풍기|히터|난로|가습기|제습기|청소기|진공청소기|로봇청소기|믹서기|블렌더|토스터|커피머신|에스프레소|식기세척기|밥솥|전기밥솥|전자레인지|오븐|인덕션|가스레인지|드라이기|고데기|면도기|전동칫솔/,
  },
  // 명품/럭셔리
  {
    category: '명품',
    pattern: /명품|샤넬|루이비통|에르메스|구찌|프라다|롤렉스|까르띠에|티파니|디올/,
  },
];

function isExcluded(keyword: string): { excluded: boolean; reason: string | null } {
  for (const { category, pattern } of EXCLUDE_PATTERNS) {
    if (pattern.test(keyword)) {
      return { excluded: true, reason: category };
    }
  }
  return { excluded: false, reason: null };
}

// ─────────────────────────────────────────────────────────
// 카테고리 추정 (공산품 분류용)
// ─────────────────────────────────────────────────────────

function guessCategory(keyword: string): string {
  if (/주방|식기|컵|냄비|프라이팬|도마|칼|밀폐용기|보온병/.test(keyword)) return '주방용품';
  if (/욕실|샤워|수건|타올|치약|세면대|변기|비누/.test(keyword)) return '욕실용품';
  if (/청소|걸레|먼지|세제|섬유유연제|쓰레기|빨래/.test(keyword)) return '청소/세탁';
  if (/인테리어|시트지|타일|벽지|커튼|러그|매트|쿠션|액자|조명/.test(keyword)) return '인테리어';
  if (/차량|자동차|시트커버|핸들|블랙박스|차박/.test(keyword)) return '차량용품';
  if (/캠핑|텐트|등산|배낭|아이스박스|버너|코펠/.test(keyword)) return '캠핑/레저';
  if (/반려|강아지|고양이|애견|개껌|배변|사료/.test(keyword)) return '반려동물';
  if (/공구|드라이버|망치|작업|장갑|작업복/.test(keyword)) return '작업도구';
  if (/사무|문구|볼펜|노트|서랍|책상/.test(keyword)) return '사무/문구';
  if (/수영|고글|튜브|물놀이|레저|러닝|운동|피트니스|요가|덤벨/.test(keyword)) return '레저/스포츠';
  if (/식품|면|밥|국|반찬|간식|과자|음료|커피|차/.test(keyword)) return '식품';
  if (/밴드|마스크|손소독제|체온계|찜질팩|핫팩|쿨팩/.test(keyword)) return '의료/위생';
  return '생활용품';
}

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────

interface Candidate {
  keyword: string;
  score: number;
  reason: string;
  peakMonth: number;
  prepMonth: number;
  seasonalityRatio: number;
  isAgricultural: boolean;
  matchedAgriLabels: string[];
  guessedCategory: string;
}

(async () => {
  console.log('=== 5월 대량 상품 발굴 시작 ===\n');

  // 회사 정보
  const agriRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'agricultural'));
  const indRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'industrial'));
  const agriCo = agriRows[0]!;
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  // 이미 등록된 키워드 (중복 방지)
  const existingProducts = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.status, 'research'));
  const existingNames = new Set(existingProducts.map((p) => p.name));
  console.log(`이미 등록된 키워드: ${existingNames.size}개\n`);

  // 시즌 분석 데이터 로드
  const fetched = await db
    .select({ keyword: keywordChartFetches.keyword })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.last_status, 'ok'));
  const keywords = fetched.map((r) => r.keyword);
  console.log(`분석 대상: ${keywords.length}개 키워드\n`);

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

  // 후보 추출
  const candidates: Candidate[] = [];
  let excludedCount = 0;
  const excludedSamples: Record<string, string[]> = {};

  for (const keyword of keywords) {
    if (existingNames.has(keyword)) continue;
    const daily = dailyByKeyword.get(keyword);
    if (!daily || daily.length === 0) continue;

    const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
    if (!analysis) continue;
    const rel = getMonthRelevance(analysis, TARGET_MONTH);
    if (rel.score < MIN_SCORE) continue;

    // 제외 카테고리 필터
    const ex = isExcluded(keyword);
    if (ex.excluded) {
      excludedCount++;
      if (!excludedSamples[ex.reason!]) excludedSamples[ex.reason!] = [];
      if (excludedSamples[ex.reason!]!.length < 3) {
        excludedSamples[ex.reason!]!.push(keyword);
      }
      continue;
    }

    // 농산물 매칭 검사
    const { combined: labels } = extractAllKeywords(keyword);
    const agriLabels = labels.filter((l) => PRIMARY_PRODUCT_LABELS.has(l));

    candidates.push({
      keyword,
      score: rel.score,
      reason: rel.reason,
      peakMonth: analysis.peak_month,
      prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio,
      isAgricultural: agriLabels.length > 0,
      matchedAgriLabels: agriLabels,
      guessedCategory: agriLabels.length > 0 ? '농산물' : guessCategory(keyword),
    });
  }

  console.log(`제외된 키워드: ${excludedCount}개`);
  for (const [reason, samples] of Object.entries(excludedSamples)) {
    console.log(`  - ${reason}: ${samples.join(', ')} 등`);
  }
  console.log(``);

  // 정렬: 5점 > 4점, 같으면 시즌성 큰 순
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.seasonalityRatio - a.seasonalityRatio;
  });

  console.log(`총 후보: ${candidates.length}개 → 상위 ${TARGET_COUNT}개 등록\n`);

  // 30개 등록
  const top = candidates.slice(0, TARGET_COUNT);
  const agriList = top.filter((c) => c.isAgricultural);
  const indList = top.filter((c) => !c.isAgricultural);

  console.log(`  농산물: ${agriList.length}개 → ${agriCo.name}`);
  console.log(`  공산품: ${indList.length}개 → ${indCo.name}\n`);

  interface Registered {
    code: string;
    id: string;
    name: string;
    category: string;
    score: number;
    seasonRatio: number;
    peakMonth: number;
    vendors?: Array<{ name: string; phone: string | null }>;
  }
  const registered: { agri: Registered[]; ind: Registered[] } = { agri: [], ind: [] };

  // 농산물 등록 + 농가 매칭
  for (const c of agriList) {
    const code = await suggestNextProductCode(agriCo.id);
    const inserted = await withCompanyContext(agriCo.id, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          company_id: agriCo.id,
          code,
          name: c.keyword,
          category: c.guessedCategory,
          status: 'research',
          description: `시즌 점수 ${c.score}점. ${c.reason} 매칭 농산물: ${c.matchedAgriLabels.join(', ')}.`,
          supply_type: 'domestic_vendor',
          season_peak_month: c.peakMonth || null,
          season_prep_month: c.prepMonth || null,
          seasonality_ratio: c.seasonalityRatio.toString(),
          season_score: c.score,
        })
        .returning({ id: products.id, code: products.code });
      // 농가 매칭 top 3
      const matches = await matchVendorsForProduct(tx, {
        productName: c.keyword,
        seasonPeakMonth: c.peakMonth || null,
        seasonPrepMonth: c.prepMonth || null,
        limit: 3,
      });
      return { row: row!, matches };
    });
    registered.agri.push({
      code: inserted.row.code,
      id: inserted.row.id,
      name: c.keyword,
      category: c.guessedCategory,
      score: c.score,
      seasonRatio: c.seasonalityRatio,
      peakMonth: c.peakMonth,
      vendors: inserted.matches.map((m: MatchResult) => ({
        name: m.vendor.biz_name,
        phone: m.vendor.repr_tel_no ?? m.vendor.biz_mobile,
      })),
    });
    console.log(`  ✅ [${agriCo.name}] ${inserted.row.code} ${c.keyword}`);
  }

  // 공산품 등록
  for (const c of indList) {
    const code = await suggestNextProductCode(indCo.id);
    const inserted = await withCompanyContext(indCo.id, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          company_id: indCo.id,
          code,
          name: c.keyword,
          category: c.guessedCategory,
          status: 'research',
          description: `시즌 점수 ${c.score}점. ${c.reason} 추정 카테고리: ${c.guessedCategory}.`,
          supply_type: 'overseas_supplier',
          season_peak_month: c.peakMonth || null,
          season_prep_month: c.prepMonth || null,
          seasonality_ratio: c.seasonalityRatio.toString(),
          season_score: c.score,
        })
        .returning({ id: products.id, code: products.code });
      return row!;
    });
    registered.ind.push({
      code: inserted.code,
      id: inserted.id,
      name: c.keyword,
      category: c.guessedCategory,
      score: c.score,
      seasonRatio: c.seasonalityRatio,
      peakMonth: c.peakMonth,
    });
    console.log(`  ✅ [${indCo.name}] ${inserted.code} ${c.keyword} (${c.guessedCategory})`);
  }

  // 결과 마크다운 요약
  console.log('\n\n===== 등록 결과 마크다운 =====\n');
  console.log(`# ${TARGET_COUNT}개 추가 등록 완료\n`);
  console.log(`## 🌾 농산물 ${registered.agri.length}개 → ${agriCo.name}\n`);
  console.log(`| # | 코드 | 상품 | 시즌 | 카테고리 | 매칭 농가 (전화) |`);
  console.log(`|---|---|---|---|---|---|`);
  registered.agri.forEach((p, i) => {
    const vendors = (p.vendors ?? [])
      .slice(0, 2)
      .map((v) => `${v.name} ${v.phone ? `(${v.phone})` : ''}`)
      .join(' / ');
    console.log(
      `| ${i + 1} | \`${p.code}\` | **${p.name}** | ${p.score}점, ${p.seasonRatio.toFixed(1)}배 | ${p.category} | ${vendors || '-'} |`,
    );
  });

  console.log(`\n## 🏭 공산품 ${registered.ind.length}개 → ${indCo.name}\n`);
  console.log(`| # | 코드 | 상품 | 시즌 | 카테고리 |`);
  console.log(`|---|---|---|---|---|`);
  registered.ind.forEach((p, i) => {
    console.log(`| ${i + 1} | \`${p.code}\` | **${p.name}** | ${p.score}점, ${p.seasonRatio.toFixed(1)}배 | ${p.category} |`);
  });

  // 통계
  console.log(`\n\n===== 회사별 research 단계 합계 =====`);
  for (const co of [agriCo, indCo]) {
    const [cnt] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(products)
      .where(sql`${products.company_id} = ${co.id} AND ${products.status} = 'research'`);
    console.log(`  ${co.name}: ${cnt?.c ?? 0}개`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
