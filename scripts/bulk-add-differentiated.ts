/**
 * 농수산물 차별화 + 공산품 sweet spot 일괄 등록
 *
 * 농수산물 (거래처 패턴 — "기본 + 차별화"):
 *   - 세척/컷팅/깐 시리즈
 *   - 신품종 (신비복숭아 등)
 *   - 시즌 한정 (햇양파 등)
 *
 * 공산품 (형 기준 v2):
 *   - 작고 가벼움
 *   - 1688 풍부
 *   - 리뷰 500이하 + 가격 1~10만 추정 카테고리
 *   - 브랜드 약함
 */
import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

interface Item {
  name: string;
  category: string;
  note: string;
  peak?: number;
  prep?: number;
}

const AGRI: Item[] = [
  {
    name: '세척감자',
    category: '농산물(세척)',
    note: '거래처 패턴 — 일반 감자 시장 포화, 세척/편의 차별화. 1인가구 + 아침식사. 가공업체 매칭 필요.',
  },
  {
    name: '세척사과',
    category: '농산물(세척)',
    note: '거래처 진입 확인. 자취생/사무실 간식. 새벽배송 적합. 가공업체 (전해수 세척) 필요.',
  },
  {
    name: '신비복숭아',
    category: '농산물(신품종)',
    note: '거래처 진입 확인. 천도+백도 합친 신품종. 6~7월 짧은 제철. 단가 ↑ (800g 1만원).',
    peak: 7,
    prep: 5,
  },
  {
    name: '깐마늘',
    category: '농산물(편의)',
    note: '편의 가공식품. 상시 수요. 가공업체 매칭 필요.',
  },
  {
    name: '다진마늘',
    category: '농산물(편의)',
    note: '깐마늘보다 더 가공. 다양한 패키지 (튜브/큐브). 상시 수요.',
  },
  {
    name: '컷팅수박',
    category: '농산물(편의)',
    note: '1인가구 + 새벽배송. 수박 시즌 (6~8월) 직전 진입. 가공업체 매칭.',
    peak: 7,
    prep: 5,
  },
  {
    name: '깐양파',
    category: '농산물(편의)',
    note: '편의 가공. 김장철 / 요리용 수요. 상시.',
  },
  {
    name: '절임배추',
    category: '농산물(가공)',
    note: '가을 김장 시즌 (10~11월). 지금 농가 사전 컨택 가능. 형 사업 적합 (위탁판매).',
    peak: 11,
    prep: 9,
  },
  {
    name: '손질부추',
    category: '농산물(편의)',
    note: '편의 + 봄 시즌. 부추 5~6월 피크. 가공업체 매칭.',
    peak: 6,
    prep: 5,
  },
  {
    name: '햇양파',
    category: '농산물(시즌)',
    note: '5~7월 햇양파 시즌. 시즌 한정성 = 마케팅 포인트. 농가 직거래 가능.',
    peak: 6,
    prep: 5,
  },
];

const IND: Item[] = [
  {
    name: '손가락 보호대',
    category: '의료/위생',
    note: '의료 needs 명확 (관절/통증). 작고 가벼움. 1688 풍부.',
  },
  {
    name: '폼롤러',
    category: '운동/회복',
    note: '운동 회복 매니아. 형 sweet spot — 작고 (미니/소형) 가벼움. 브랜드 약함.',
  },
  {
    name: '양말 정리함',
    category: '수납',
    note: '작은 부피, 1688 가성비. 디자인/소재 차별화 가능.',
  },
  {
    name: '옷 압축팩',
    category: '여행',
    note: '여행/이사 needs. 1688 풍부, 다양한 크기 SKU.',
  },
  {
    name: '진공 압축팩',
    category: '수납',
    note: '의류 보관, 계절 수요 (옷 정리). 작고 1688 가성비.',
  },
  {
    name: '캐리어 커버',
    category: '여행',
    note: '여행 캐리어 보호. 작은 부피, 디자인 차별화.',
  },
  {
    name: '자전거 자물쇠',
    category: '자전거',
    note: '자전거 시즌 (봄~가을). 작고 1688 풍부. 의료/안전 needs.',
    peak: 6,
    prep: 5,
  },
  {
    name: '골프 그립',
    category: '골프',
    note: '골프 매니아. 작고 가벼움. 브랜드 영향 적음 (저관여 액세서리).',
  },
  {
    name: '휴대용 단우산',
    category: '우산',
    note: '장마철 (6~7월) 시즌. 작고 가벼움. 1688 풍부.',
    peak: 7,
    prep: 5,
  },
  {
    name: '미니 김치통',
    category: '주방용품',
    note: '1인가구 김치 보관. 작은 부피. 디자인/색상 차별화.',
  },
];

(async () => {
  const agriRows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const agriCo = agriRows[0]!;
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  const existing = await db.select({ name: products.name }).from(products).where(eq(products.status, 'research'));
  const existingNames = new Set(existing.map((p) => p.name));

  let agriCount = 0;
  let indCount = 0;

  console.log('=== 농수산물 차별화 등록 ===');
  for (const item of AGRI) {
    if (existingNames.has(item.name)) {
      console.log(`  ⏭ 이미 등록: ${item.name}`);
      continue;
    }
    const code = await suggestNextProductCode(agriCo.id);
    await withCompanyContext(agriCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: agriCo.id,
        code,
        name: item.name,
        category: item.category,
        status: 'research',
        description: `[차별화 패턴] ${item.note}`,
        supply_type: 'domestic_vendor',
        season_peak_month: item.peak ?? null,
        season_prep_month: item.prep ?? null,
        season_score: item.peak ? 5 : null,
      });
    });
    console.log(`  ✅ ${code} ${item.name} (${item.category})`);
    agriCount++;
  }

  console.log('\n=== 공산품 sweet spot 등록 ===');
  for (const item of IND) {
    if (existingNames.has(item.name)) {
      console.log(`  ⏭ 이미 등록: ${item.name}`);
      continue;
    }
    const code = await suggestNextProductCode(indCo.id);
    await withCompanyContext(indCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: indCo.id,
        code,
        name: item.name,
        category: item.category,
        status: 'research',
        description: `[sweet spot v2] ${item.note}`,
        supply_type: 'overseas_supplier',
        season_peak_month: item.peak ?? null,
        season_prep_month: item.prep ?? null,
        season_score: item.peak ? 5 : null,
      });
    });
    console.log(`  ✅ ${code} ${item.name} (${item.category})`);
    indCount++;
  }

  console.log(`\n신규: 농수산물 ${agriCount}개 / 공산품 ${indCount}개 = ${agriCount + indCount}개`);

  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
