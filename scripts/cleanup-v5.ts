#!/usr/bin/env node
/**
 * 정리 v5 — 헤어케어 자동 삭제 + 화장품 정규식 강화 + 공산품 보강
 *
 * 학습: "헤어", "두피", "스킨", "케어" 부분어 = 화장품/뷰티
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, keywordChartDaily, keywordChartFetches, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';
import { PRIMARY_PRODUCT_LABELS, extractAllKeywords } from '../src/lib/vendors/keywords';

const TARGET_MONTH = 5;
const MIN_SCORE = 4;
const TARGET_TOTAL = 40;
const CHUNK_SIZE = 50;

// 음료 정규식
const BEVERAGE_PATTERN = /^(음료|주스|콜라|사이다|탄산수|생수|우유|두유|커피|아이스커피|아메리카노|라떼|에이드|밀크티|보이차|보리차|국화차|허브차|녹차|홍차|율무차|쌍화차|생강차|대추차|꿀차|유자차|매실차|식혜|수정과|쥬스)$|즙(?!기|석)$|^[가-힣]+액$|에이드$/;

const EXCLUDE_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  // 화장품/뷰티 — 헤어/두피/케어/스킨 부분어 추가 (v5 강화)
  { category: '화장품/뷰티', pattern: /화장품|로션|크림|세럼|토너|에센스|미스트|마스카라|아이라이너|아이섀도|립스틱|블러셔|컨실러|쿠션|파운데이션|선크림|선스틱|샴푸|린스|트리트먼트|헤어팩|헤어케어|헤어\s*에센스|두피\s*샴푸|두피케어|두피|스킨케어|바디케어|바디로션|바디오일|네일\s*케어|뷰티케어|미백|미백크림|메이크업|네일|매니큐어|향수|퍼퓸|코롱|디퓨저|향초|마스크\s*\/?\s*팩|마스크팩|시트마스크|^케어$|^뷰티$|^스킨$|^헤어$/ },
  { category: '의류', pattern: /원피스|티셔츠|셔츠|블라우스|니트|가디건|스웨터|자켓|점퍼|패딩|코트|청바지|진(?!액|짜)|바지|레깅스|치마|스커트|수영복|비키니|레쉬가드|등산복|러닝화|운동화|스니커즈|로퍼|구두|샌들|슬리퍼|부츠|양말|스타킹|속옷|브라|팬티|가방|지갑|벨트/ },
  { category: '영양제/건기식', pattern: /영양제|건강기능|비타민|오메가|콜라겐|프로바이오틱스|유산균|루테인|밀크씨슬|글루타치온|마그네슘|칼슘|아연|철분|코엔자임|타우린|크레아틴|단백질\s*보충제|프로틴/ },
  { category: '가전', pattern: /tv|텔레비전|냉장고|세탁기|건조기|에어컨|공기청정기|선풍기|히터|난로|가습기|제습기|청소기|진공청소기|로봇청소기|믹서기|블렌더|토스터|커피머신|에스프레소|식기세척기|밥솥|전자레인지|오븐|인덕션|드라이기|고데기|면도기|전동칫솔|주방가전|가전/ },
  { category: '명품', pattern: /명품|샤넬|루이비통|에르메스|구찌|프라다|롤렉스|까르띠에|티파니|디올/ },
  { category: '포괄적', pattern: /^(워터파크|물놀이|스포츠레저|축구|야구|농구|배구|등산|캠핑|레저|운동|피트니스|건강|뷰티|패션|취미|문구|놀이|여행|쇼핑|케어)$/ },
  { category: '육가공', pattern: /훈제|오리고기|^안심$|^등심$|^삼겹살$|^목살$|차돌박이|육포|소세지|소시지|^햄$|베이컨|미트볼/ },
  { category: '가구/부피큰거', pattern: /^(침구|침대|책상|소파|옷장|책장|진열장|선반|장롱|식탁|의자|러그|매트리스|매트(?!\s*형)|토퍼|서랍장|수납장|행거)$|커튼|블라인드/ },
  { category: '식품제조/신선식품', pattern: /^(면류|곤약면|만두|즉석밥|컵라면|컵면|햇반|떡(?!볶이)|쌀과자|국|반찬|김치|장아찌|젓갈|샐러드|핫도그|라면|치킨|피자|과자|초콜릿|아이스크림|짜장|우동|국수|반조리|간편식|냉동식품|밀키트|도시락|샌드위치|버거|돈까스|돈가스)$/ },
  { category: '세제류', pattern: /섬유유연제|주방세제|빨래세제|세탁세제|얼룩|표백제|살균|소독제(?!.*수)/ },
  { category: '음료', pattern: BEVERAGE_PATTERN },
];

function isExcluded(keyword: string): { excluded: boolean; reason: string | null } {
  for (const { category, pattern } of EXCLUDE_PATTERNS) {
    if (pattern.test(keyword)) return { excluded: true, reason: category };
  }
  return { excluded: false, reason: null };
}

const AGRI_OVERRIDE = new Set([
  '살구', '백도', '자두', '황도', '양배추', '비트', '앵두',
  '망고', '아보카도', '파인애플', '오렌지', '레몬', '귤', '석류', '키위', '용과', '체리',
  '미국체리', '하우스감귤',
]);

function guessCategory(keyword: string, isAgri: boolean): string {
  if (isAgri) return '농산물';
  if (/주방|식기|컵|냄비|프라이팬|도마|밀폐용기|보온병/.test(keyword)) return '주방용품';
  if (/욕실|샤워|수건|타올|치약|세면대|변기|비누/.test(keyword)) return '욕실용품';
  if (/청소|걸레|먼지|쓰레기|빨래/.test(keyword)) return '청소';
  if (/인테리어|시트지|타일|벽지|쿠션|액자|조명/.test(keyword)) return '인테리어';
  if (/차량|자동차|시트커버|핸들|블랙박스|차박/.test(keyword)) return '차량용품';
  if (/캠핑|텐트|배낭|아이스박스|버너|코펠/.test(keyword)) return '캠핑/레저';
  if (/반려|강아지|고양이|애견|개껌|배변|사료/.test(keyword)) return '반려동물';
  if (/공구|드라이버|망치|작업|장갑|작업복/.test(keyword)) return '작업도구';
  if (/사무|볼펜|노트/.test(keyword)) return '사무/문구';
  if (/수영|고글|튜브|러닝|요가|덤벨/.test(keyword)) return '레저/스포츠';
  if (/밴드|마스크(?!\s*팩|팩)|손소독|체온계|찜질|핫팩|쿨팩|패드/.test(keyword)) return '의료/위생';
  if (/모기|벌레|살충|개미|쥐덫/.test(keyword)) return '생활용품';
  if (/캐리어|여행|짐가방/.test(keyword)) return '여행용품';
  return '생활용품';
}

(async () => {
  const agriRows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const agriCo = agriRows[0]!;
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  // 1) 헤어케어 + 다른 화장품류 자동 삭제
  console.log('=== 1단계: 화장품/뷰티 자동 삭제 ===');
  const all = await db.select({ id: products.id, name: products.name, code: products.code }).from(products).where(eq(products.status, 'research'));
  const toDelete = all.filter((p) => isExcluded(p.name).excluded);
  if (toDelete.length > 0) {
    console.log(`  검출: ${toDelete.length}개`);
    for (const p of toDelete) {
      console.log(`  ❌ ${p.code} ${p.name} (사유: ${isExcluded(p.name).reason})`);
    }
    await db.delete(products).where(inArray(products.id, toDelete.map((p) => p.id)));
  } else {
    console.log('  검출 없음');
  }

  // 2) 빈 자리 새 공산품
  const existing = await db.select({ name: products.name }).from(products).where(eq(products.status, 'research'));
  const existingNames = new Set(existing.map((p) => p.name));
  const needed = Math.max(0, TARGET_TOTAL - existingNames.size);
  console.log(`\n현재 ${existingNames.size}개 → 추가 ${needed}개\n`);

  if (needed === 0) {
    process.exit(0);
  }

  const fetched = await db.select({ keyword: keywordChartFetches.keyword }).from(keywordChartFetches).where(eq(keywordChartFetches.last_status, 'ok'));
  const keywords = fetched.map((r) => r.keyword);
  const dailyByKeyword = new Map<string, Array<{ period: string; ratio: number }>>();
  for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
    const chunk = keywords.slice(i, i + CHUNK_SIZE);
    const rows = await db.select({ keyword: keywordChartDaily.keyword, period: keywordChartDaily.period, ratio: keywordChartDaily.ratio }).from(keywordChartDaily).where(inArray(keywordChartDaily.keyword, chunk));
    for (const r of rows) {
      if (!dailyByKeyword.has(r.keyword)) dailyByKeyword.set(r.keyword, []);
      dailyByKeyword.get(r.keyword)!.push({ period: r.period, ratio: r.ratio });
    }
  }

  interface Candidate {
    keyword: string; score: number; peakMonth: number; prepMonth: number;
    seasonalityRatio: number; isAgri: boolean; category: string;
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
    if (isExcluded(keyword).excluded) continue;
    const { combined: labels } = extractAllKeywords(keyword);
    const agriLabels = labels.filter((l) => PRIMARY_PRODUCT_LABELS.has(l));
    const isAgri = agriLabels.length > 0 || AGRI_OVERRIDE.has(keyword);
    candidates.push({
      keyword, score: rel.score, peakMonth: analysis.peak_month, prepMonth: analysis.prep_month,
      seasonalityRatio: analysis.seasonality_ratio, isAgri, category: guessCategory(keyword, isAgri),
    });
  }

  // 공산품 우선 정렬
  candidates.sort((a, b) => {
    if (a.isAgri !== b.isAgri) return a.isAgri ? 1 : -1;
    if (a.score !== b.score) return b.score - a.score;
    return b.seasonalityRatio - a.seasonalityRatio;
  });

  const top = candidates.slice(0, needed);
  for (const c of top) {
    const targetCo = c.isAgri ? agriCo : indCo;
    const code = await suggestNextProductCode(targetCo.id);
    await withCompanyContext(targetCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: targetCo.id, code, name: c.keyword, category: c.category, status: 'research',
        description: `시즌 점수 ${c.score}점, ${c.seasonalityRatio.toFixed(1)}배. v5.`,
        supply_type: c.isAgri ? 'domestic_vendor' : 'overseas_supplier',
        season_peak_month: c.peakMonth || null, season_prep_month: c.prepMonth || null,
        seasonality_ratio: c.seasonalityRatio.toString(), season_score: c.score,
      });
    });
    console.log(`  ✅ [${targetCo.name}] ${code} ${c.keyword} (${c.category}, ${c.seasonalityRatio.toFixed(1)}배)`);
  }

  console.log('\n=== 통계 ===');
  for (const co of [agriCo, indCo]) {
    const [cnt] = await db.select({ c: sql<number>`count(*)::int` }).from(products).where(sql`${products.company_id} = ${co.id} AND ${products.status} = 'research'`);
    console.log(`  ${co.name}: ${cnt?.c ?? 0}개`);
  }
  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
