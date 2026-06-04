import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

(async () => {
  const indRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'industrial'));
  const indCompany = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0];
  if (!indCompany) throw new Error('no company');

  const code = await suggestNextProductCode(indCompany.id);
  const inserted = await withCompanyContext(indCompany.id, async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        company_id: indCompany.id,
        code,
        name: '러닝용품',
        category: '스포츠',
        status: 'research',
        description:
          '봄/여름 운동 시즌. 다양한 SKU (밴드, 양말, 보호대 등). 브랜드 인지도 영향 있으니 무브랜드 가성비 진입 전략으로 한정.',
        supply_type: 'overseas_supplier',
        season_peak_month: 6,
        season_prep_month: 5,
        seasonality_ratio: '2.2',
        season_score: 5,
      })
      .returning({ id: products.id, code: products.code });
    return row!;
  });
  console.log(`✅ ${inserted.code} 러닝용품 — http://localhost:3002/products/${inserted.id}`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
