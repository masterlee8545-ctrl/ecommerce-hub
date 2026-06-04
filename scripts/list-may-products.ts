import { and, eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';

(async () => {
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

  for (const co of [agriCo, indCo]) {
    const list = await withCompanyContext(co.id, async (tx) => {
      return tx
        .select({
          code: products.code,
          name: products.name,
          id: products.id,
          category: products.category,
          season_score: products.season_score,
          seasonality_ratio: products.seasonality_ratio,
        })
        .from(products)
        .where(and(eq(products.company_id, co.id), eq(products.status, 'research')))
        .orderBy(products.code);
    });
    console.log(`\n## ${co.name} — ${list.length}개\n`);
    for (const p of list) {
      const ratio = p.seasonality_ratio ? `${Number(p.seasonality_ratio).toFixed(1)}배` : '-';
      console.log(
        `- ${p.code} **${p.name}** (${p.category}, ${p.season_score ?? '?'}점, ${ratio}) — http://localhost:3002/products/${p.id}`,
      );
    }
  }
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
