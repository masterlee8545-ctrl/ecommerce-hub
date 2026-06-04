/**
 * 슬개골 무릎보호대 등록 + 운동화 빨래망 삭제
 */
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

  // 1) 운동화 빨래망 삭제
  const deleted = await db
    .delete(products)
    .where(eq(products.name, '운동화 빨래망'))
    .returning({ code: products.code, name: products.name });
  for (const d of deleted) console.log(`❌ ${d.code} ${d.name} 삭제`);

  // 2) 슬개골 무릎보호대 등록 (기존 "무릎 보호대" 와 별개 SKU — 슬개골 전문)
  const code = await suggestNextProductCode(indCo.id);
  const inserted = await withCompanyContext(indCo.id, async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        company_id: indCo.id,
        code,
        name: '슬개골 무릎보호대',
        category: '운동보호대/의료',
        status: 'research',
        description:
          '형 직접 추천. 평균 리뷰 500+ 예상이라도 구매전환율 높은 키워드 (의료 needs 명확). 슬개골 = 무릎 부상 예방/재활, 명확한 페인포인트. 일반 무릎보호대(PROD-2026-0012)와 별개 SKU.',
        supply_type: 'overseas_supplier',
        season_score: null,
      })
      .returning({ id: products.id, code: products.code });
    return row!;
  });
  console.log(`✅ ${inserted.code} 슬개골 무릎보호대 — http://localhost:3002/products/${inserted.id}`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
