import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  const d = await db
    .delete(products)
    .where(eq(products.name, '축산물'))
    .returning({ name: products.name, code: products.code });
  console.log('삭제:', d.map((x) => `${x.code} ${x.name}`).join(', '));
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
