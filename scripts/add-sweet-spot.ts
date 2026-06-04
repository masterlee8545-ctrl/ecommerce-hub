#!/usr/bin/env node
/**
 * 형 sweet spot 큐레이션 — 보수적 12개
 *
 * 기준:
 *   - 러닝벨트 같은 작고 가벼움 + 브랜드 약함 + 1688 풍부
 *   - 운동 액세서리 / 운동 보호대 (저관여)
 *   - 욕실 소품 (디자인 차별화)
 *   - 여행 소품 (작은 부피)
 *   - 시즌 무관 상시 진입 가능
 */
import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

const CURATED = [
  // 운동 액세서리 (러닝벨트 류 — 형 성공 케이스)
  { name: '러닝벨트', category: '운동/피트니스', note: '⭐ 형 성공 케이스 재진입. 작고 가벼움 + 1688 풍부 + 브랜드 약함' },
  { name: '요가블럭', category: '운동/피트니스', note: '요가 매니아 시장, 브랜드 강한 곳 적음' },
  { name: '푸시업바', category: '운동/피트니스', note: '헬스 소도구, 1688 가성비 진입' },
  { name: '마사지볼', category: '운동/피트니스', note: '라크로스볼, 회복용 매니아' },
  { name: '저항밴드', category: '운동/피트니스', note: '라텍스밴드/트레이닝밴드, 다양한 강도' },

  // 운동 보호대 (저관여 의료/위생)
  { name: '손목 보호대', category: '운동보호대', note: '운동 보조용, 가성비 진입' },
  { name: '무릎 보호대', category: '운동보호대', note: '운동 + 일상 사용, 1688 풍부' },
  { name: '발목 보호대', category: '운동보호대', note: '운동 + 일상 사용' },

  // 욕실 소품 (작고 디자인 차별화 가능)
  { name: '비누받침대', category: '욕실소품', note: '디자인 다양, 브랜드 약함' },
  { name: '배수구 거름망', category: '욕실소품', note: '작은 부피, 가성비 진입' },

  // 여행 소품 (작고 1688 풍부)
  { name: '여행용 파우치', category: '여행', note: '메시/방수 정리 파우치, 디자인 차별화' },
  { name: '압축 가방', category: '여행', note: '의류 압축, 작은 부피' },
];

(async () => {
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;
  console.log(`회사: ${indCo.name}\n`);

  const existing = await db.select({ name: products.name }).from(products).where(eq(products.status, 'research'));
  const existingNames = new Set(existing.map((p) => p.name));

  let registered = 0;
  for (const c of CURATED) {
    if (existingNames.has(c.name)) {
      console.log(`  ⏭ 이미 등록: ${c.name}`);
      continue;
    }
    const code = await suggestNextProductCode(indCo.id);
    await withCompanyContext(indCo.id, async (tx) => {
      await tx.insert(products).values({
        company_id: indCo.id, code, name: c.name, category: c.category,
        status: 'research',
        description: `[sweet spot 큐레이션] ${c.note}`,
        supply_type: 'overseas_supplier',
        season_score: null,
      });
    });
    console.log(`  ✅ ${code} ${c.name} (${c.category})`);
    registered++;
  }

  console.log(`\n신규 ${registered}개 등록`);
  const [total] = await db.select({ c: sql<number>`count(*)::int` }).from(products).where(eq(products.status, 'research'));
  console.log(`총 등록 상품: ${total?.c ?? 0}개`);

  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
