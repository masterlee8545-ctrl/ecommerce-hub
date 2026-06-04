#!/usr/bin/env node
/**
 * 등록된 상품 정리 + 빈 자리 새 후보 추가
 *
 * 처리:
 *   1. 형 지시 — 10개 삭제 (포괄/육가공/침구/대형 한국 브랜드)
 *   2. 분류 오류 6개 이전 (바이와이즈 농산물 → 유어밸류)
 *   3. 빈 자리만큼 새 후보 등록 (제외 강화)
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

const TARGET_MONTH = 5;
const MIN_SCORE = 4;
const CHUNK_SIZE = 50;

// ─────────────────────────────────────────────────────────
// 제외 정규식 (강화)
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
  // 포괄적/카테고리 키워드 (구체 상품 X)
  {
    category: '포괄적',
    pattern: /^(워터파크|물놀이|스포츠레저|축구|야구|농구|배구|등산|캠핑|레저|운동|피트니스)$/,
  },
  // 육가공
  {
    category: '육가공',
    pattern: /훈제|오리고기|안심|등심|삼겹살|목살|차돌박이|육포|소세지|소시지|햄|베이컨|미트볼/,
  },
  // 침구
  {
    category: '침구',
    pattern: /침구|이불|베개|매트리스|시트|토퍼|패드|커버(?!송)/,
  },
  // 대형 한국 브랜드 키워드 (식품)
  {
    category: '한국 대형 브랜드',
    pattern: /^(라면|핫도그|샐러드|아이스커피|탄산수|만두|떡볶이|치킨|피자|음료|과자|초콜릿|아이스크림|커피)$/,
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

// 분류 오류 농산물 키워드 (수동 매핑 — 키워드 사전에 없는 농산물)
const AGRI_OVERRIDE = new Set([
  '살구',
  '백도',
  '자두',
  '황도',
  '양배추',
  '비트',
  '망고',
  '아보카도',
  '파인애플',
  '오렌지',
  '레몬',
  '귤',
  '석류',
  '키위',
  '용과',
]);

function guessCategory(keyword: string, isAgri: boolean): string {
  if (isAgri) return '농산물';
  if (/주방|식기|컵|냄비|프라이팬|도마|칼|밀폐용기|보온병/.test(keyword)) return '주방용품';
  if (/욕실|샤워|수건|타올|치약|세면대|변기|비누/.test(keyword)) return '욕실용품';
  if (/청소|걸레|먼지|세제|섬유유연제|쓰레기|빨래/.test(keyword)) return '청소/세탁';
  if (/인테리어|시트지|타일|벽지|커튼|러그|매트|쿠션|액자|조명/.test(keyword)) return '인테리어';
  if (/차량|자동차|시트커버|핸들|블랙박스|차박/.test(keyword)) return '차량용품';
  if (/캠핑|텐트|등산|배낭|아이스박스|버너|코펠/.test(keyword)) return '캠핑/레저';
  if (/반려|강아지|고양이|애견|개껌|배변|사료/.test(keyword)) return '반려동물';
  if (/공구|드라이버|망치|작업|장갑|작업복/.test(keyword)) return '작업도구';
  if (/사무|문구|볼펜|노트|서랍|책상/.test(keyword)) return '사무/문구';
  if (/수영|고글|튜브|러닝|요가|덤벨/.test(keyword)) return '레저/스포츠';
  if (/밴드|마스크|손소독제|체온계|찜질팩|핫팩|쿨팩|패드/.test(keyword)) return '의료/위생';
  if (/곤약|즉석|간편|다이어트면/.test(keyword)) return '식품';
  return '생활용품';
}

(async () => {
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

  // ─── 1) 형 지시 삭제 ───
  console.log('=== 1단계: 형 지시 키워드 삭제 ===');
  const TO_DELETE = [
    '워터파크', '물놀이', '스포츠레저', '축구',
    '훈제오리', '오리고기', '안심',
    '침구',
    '라면', '핫도그',
  ];
  for (const co of [agriCo, indCo]) {
    const deleted = await withCompanyContext(co.id, async (tx) => {
      return tx
        .delete(products)
        .where(
          and(
            eq(products.company_id, co.id),
            inArray(products.name, TO_DELETE),
          ),
        )
        .returning({ name: products.name });
    });
    if (deleted.length > 0) {
      console.log(`  [${co.name}] 삭제: ${deleted.map((d) => d.name).join(', ')}`);
    }
  }

  // ─── 2) 분류 오류 농산물 이전 (바이와이즈 → 유어밸류) ───
  console.log('\n=== 2단계: 분류 오류 농산물 이전 (바이와이즈 → 유어밸류) ===');
  const TO_MOVE = ['살구', '백도', '자두', '황도', '양배추', '비트'];

  // 바이와이즈에서 정보 가져옴
  const indProducts = await withCompanyContext(indCo.id, async (tx) => {
    return tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.company_id, indCo.id),
          inArray(products.name, TO_MOVE),
        ),
      );
  });

  // 유어밸류로 새로 등록 (코드 재발급)
  for (const p of indProducts) {
    const newCode = await suggestNextProductCode(agriCo.id);
    await withCompanyContext(agriCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: agriCo.id,
        code: newCode,
        name: p.name,
        category: '농산물',
        status: 'research',
        description: p.description,
        supply_type: 'domestic_vendor',
        season_peak_month: p.season_peak_month,
        season_prep_month: p.season_prep_month,
        seasonality_ratio: p.seasonality_ratio,
        season_score: p.season_score,
      });
    });
    console.log(`  ✅ ${p.name} 이전 → ${agriCo.name} ${newCode}`);
  }

  // 바이와이즈에서 삭제
  await withCompanyContext(indCo.id, async (tx) => {
    await tx
      .delete(products)
      .where(
        and(
          eq(products.company_id, indCo.id),
          inArray(products.name, TO_MOVE),
        ),
      );
  });

  // ─── 3) 빈 자리만큼 새 후보 추가 ───
  console.log('\n=== 3단계: 빈 자리 새 후보 추가 ===');

  // 현재 등록된 상품 개수 (목표: 40개)
  const TARGET_TOTAL = 40;
  const existingProducts = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.status, 'research'));
  const existingNames = new Set(existingProducts.map((p) => p.name));
  console.log(`  현재 등록: ${existingNames.size}개 / 목표: ${TARGET_TOTAL}개`);
  const needed = Math.max(0, TARGET_TOTAL - existingNames.size);
  if (needed === 0) {
    console.log('  채울 자리 없음');
    process.exit(0);
  }
  console.log(`  추가 필요: ${needed}개\n`);

  // 시즌 분석 데이터 로드
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

  // 후보 추출
  interface Candidate {
    keyword: string;
    score: number;
    peakMonth: number;
    prepMonth: number;
    seasonalityRatio: number;
    isAgri: boolean;
    category: string;
  }
  const candidates: Candidate[] = [];
  for (const keyword of keywords) {
    if (existingNames.has(keyword)) continue;

    const daily = dailyByKeyword.get(keyword);
    if (!daily || daily.length === 0) continue;

    const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
    if (!analysis) continue;

    const rel = getMonthRelevance(analysis, TARGET_MONTH);
    if (rel.score < MIN_SCORE) continue;

    const ex = isExcluded(keyword);
    if (ex.excluded) continue;

    const { combined: labels } = extractAllKeywords(keyword);
    const agriLabels = labels.filter((l) => PRIMARY_PRODUCT_LABELS.has(l));
    const isAgri = agriLabels.length > 0 || AGRI_OVERRIDE.has(keyword);

    candidates.push({
      keyword,
      score: rel.score,
      peakMonth: analysis.peak_month,
      prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio,
      isAgri,
      category: guessCategory(keyword, isAgri),
    });
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.seasonalityRatio - a.seasonalityRatio;
  });

  const top = candidates.slice(0, needed);
  console.log(`  후보 ${candidates.length}개 중 상위 ${top.length}개 등록\n`);

  for (const c of top) {
    const targetCo = c.isAgri ? agriCo : indCo;
    const code = await suggestNextProductCode(targetCo.id);
    await withCompanyContext(targetCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: targetCo.id,
        code,
        name: c.keyword,
        category: c.category,
        status: 'research',
        description: `시즌 점수 ${c.score}점, 시즌성 ${c.seasonalityRatio.toFixed(1)}배. 자동 발굴.`,
        supply_type: c.isAgri ? 'domestic_vendor' : 'overseas_supplier',
        season_peak_month: c.peakMonth || null,
        season_prep_month: c.prepMonth || null,
        seasonality_ratio: c.seasonalityRatio.toString(),
        season_score: c.score,
      });
    });
    console.log(`  ✅ [${targetCo.name}] ${code} ${c.keyword} (${c.category}, ${c.seasonalityRatio.toFixed(1)}배)`);
  }

  // ─── 결과 통계 ───
  console.log('\n\n=== 최종 통계 ===');
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
