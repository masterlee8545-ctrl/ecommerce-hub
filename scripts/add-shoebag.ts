import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

(async () => {
  const indRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'industrial'));
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  const code = await suggestNextProductCode(indCo.id);
  const inserted = await withCompanyContext(indCo.id, async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        company_id: indCo.id,
        code,
        name: '운동화 빨래망',
        category: '세탁/청소',
        status: 'research',
        description:
          '[강의 추천 + sweet spot] 작고 가벼움 + 1688 풍부 + 브랜드 약함 + 가성비 진입. SKU 차별화 (크기/강도/디자인) 가능. 러닝벨트와 같은 결.',
        supply_type: 'overseas_supplier',
        season_score: null,
      })
      .returning({ id: products.id, code: products.code });
    return row!;
  });
  console.log(`✅ ${inserted.code} 운동화 빨래망 — http://localhost:3002/products/${inserted.id}`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
