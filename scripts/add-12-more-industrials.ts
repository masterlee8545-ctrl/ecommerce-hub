/**
 * 공산품 12개 추가 — 매니아 + 명확한 페인포인트 + 1688 풍부
 *
 * 키워드 선정 기준:
 *   1. 작고 가벼움 (1688 직배송)
 *   2. 명확한 페인포인트 (구매 동기 강함)
 *   3. 1688 풍부 + 브랜드 약함
 *   4. 매니아/입문자 시장 (가성비로 진입)
 *   5. 화장품/의류/가전/캠핑/식품 모두 X
 *
 * 3법인 비중대로 분배:
 *   - 유어밸류 (50%) 6개
 *   - 유어옵티멀 (25%) 3개
 *   - 바이와이즈 (25%) 3개
 */
import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

interface Item {
  name: string;
  category: string;
  note: string;
  peak?: number;
}

const NEW_12: Item[] = [
  // 의료/위생 — 명확한 페인포인트
  { name: '메모리폼 목베개', category: '수면/의료', note: '목 통증 매니아, 1688 풍부, 작은 부피, 차박/여행/사무 다용도' },
  { name: '자세 교정 밴드', category: '의료/위생', note: '거북목/라운드 숄더 페인포인트 명확, 직장인 매니아' },
  { name: '발 각질 제거기', category: '의료/위생', note: '수동 (전자 X), 여름 시즌 페인포인트, 매니아', peak: 7 },

  // 운동 매니아
  { name: 'AB 휠', category: '헬스', note: '복근롤러, 헬스 매니아 입문, 작고 가성비, 1688 풍부' },
  { name: '줄넘기', category: '운동', note: '다이어트 시즌 + 입문 운동, 1688 가성비, 디지털 줄넘기 X 일반' },

  // 인테리어/일상 — 자취생 페인포인트
  { name: '강력 자석 후크', category: '수납', note: '다용도 (현관/욕실/주방), 1688 풍부, 디자인 차별화' },
  { name: '문틈 막이', category: '인테리어', note: '방음/방한, 자취생/원룸 시장, 작은 부피, 1688 풍부' },

  // 주방 매니아
  { name: '마늘 다지기', category: '주방용품', note: '수동 도구 (전자 X), 요리 매니아, 작음, 디자인 차별화' },
  { name: '자석 칼걸이', category: '주방용품', note: '주방 미니멀, 작은 부피, 디자인 차별화 강함' },

  // 차량 — 여름 시즌
  { name: '차량 햇빛가리개', category: '차량용품', note: '여름 시즌 (6~8월), 앞유리 접이형, 1688 풍부', peak: 7 },

  // 일상 디테일
  { name: '이어폰 정리 케이스', category: '수납', note: '에어팟/유선 정리, 작음, 디자인 차별화, 1688 풍부' },
  { name: '속옷 세탁망', category: '세탁용품', note: '속옷/캐시미어 전용, 작은 부피, 1688 가성비' },
];

(async () => {
  const agriCo = (await db.select().from(companies).where(eq(companies.business_type, 'agricultural')))[0]!;
  const optCo = (await db.select().from(companies).where(eq(companies.business_type, 'other')))[0]!;
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  // 비중대로 분배 (50:25:25 = 6:3:3)
  const distribution = [
    { co: agriCo, items: NEW_12.slice(0, 6) },
    { co: optCo, items: NEW_12.slice(6, 9) },
    { co: indCo, items: NEW_12.slice(9, 12) },
  ];

  const existing = await db.select({ name: products.name }).from(products).where(eq(products.status, 'research'));
  const existingNames = new Set(existing.map((p) => p.name));

  let count = 0;
  for (const { co, items } of distribution) {
    console.log(`\n[${co.name}]`);
    for (const item of items) {
      if (existingNames.has(item.name)) {
        console.log(`  ⏭ 이미 등록: ${item.name}`);
        continue;
      }
      const code = await suggestNextProductCode(co.id);
      await withCompanyContext(co.id, async (tx) => {
        await tx.insert(products).values({
          company_id: co.id,
          code,
          name: item.name,
          category: item.category,
          status: 'research',
          description: `[추가 큐레이션] ${item.note}`,
          supply_type: 'overseas_supplier',
          season_peak_month: item.peak ?? null,
          season_score: item.peak ? 5 : null,
        });
      });
      console.log(`  ✅ ${code} ${item.name} (${item.category})`);
      count++;
    }
  }

  console.log(`\n신규: ${count}개 등록`);
  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, 'research'));
  console.log(`총 등록 상품: ${total?.n ?? 0}개`);

  process.exit(0);
})().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
