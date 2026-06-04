import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  const rows = await db.select({
    name: products.name,
    code: products.code,
    supply_type: products.supply_type,
    cogs_cny: products.cogs_cny,
    cogs_krw: products.cogs_krw,
  }).from(products).where(eq(products.name, '풋고추'));
  rows.forEach((r) => {
    console.log(`${r.code} ${r.name}: supply_type="${r.supply_type}", cogs_cny=${r.cogs_cny}, cogs_krw=${r.cogs_krw}`);
  });
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
