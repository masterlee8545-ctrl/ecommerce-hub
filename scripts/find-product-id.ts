import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { products, companies } from '../src/db/schema';

(async () => {
  const targets = ['풋고추', '블루베리', '땀패드', '러닝벨트', '천도복숭아', '자반고등어'];
  for (const name of targets) {
    const rows = await db.select({
      id: products.id,
      code: products.code,
      name: products.name,
      company_id: products.company_id,
      supply_type: products.supply_type,
    }).from(products).where(eq(products.name, name));
    for (const r of rows) {
      const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, r.company_id));
      console.log(`${name} [${co?.name}] ${r.code} → http://localhost:3002/products/${r.id}`);
    }
    if (rows.length === 0) console.log(`${name}: 없음`);
  }
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
