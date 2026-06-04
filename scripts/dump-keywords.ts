/**
 * 100개 키워드 → 콘솔 JS 코드 형태로 출력
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

(async () => {
  const rows = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.status, 'research'));
  const keywords = rows.map((r) => r.name);
  console.log(`총 ${keywords.length}개 키워드`);
  console.log(`\nJSON:`);
  console.log(JSON.stringify(keywords));
  process.exit(0);
})();
