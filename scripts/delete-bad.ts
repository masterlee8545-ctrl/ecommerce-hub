import { inArray } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  const d = await db
    .delete(products)
    .where(inArray(products.name, ['마스크/팩', '주방가전']))
    .returning({ name: products.name, code: products.code });
  console.log('삭제:', d.map((r) => `${r.code} ${r.name}`).join(' / '));
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
