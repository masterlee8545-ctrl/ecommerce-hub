import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { products, companies } from '../src/db/schema';

(async () => {
  const cos = await db.select().from(companies);
  let total = 0;
  for (const co of cos) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.company_id, co.id));
    if (r && r.n > 0) {
      console.log(`${co.name}: ${r.n}개`);
      total += r.n;
    }
  }
  console.log(`\n총 ${total}개`);
  process.exit(0);
})();
