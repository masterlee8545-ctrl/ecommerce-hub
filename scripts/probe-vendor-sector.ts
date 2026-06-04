import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, vendors } from '../src/db/schema';

(async () => {
  const rows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'agricultural'));
  if (!rows[0]) throw new Error('no company');
  await withCompanyContext(rows[0].id, async (tx) => {
    const samples = (await tx
      .select({
        name: vendors.biz_name,
        biz_sector: vendors.biz_sector,
        intro: vendors.intro_html,
      })
      .from(vendors)
      .where(
        sql`biz_sector ILIKE '%참외%' OR biz_sector ILIKE '%복숭아%' OR biz_sector ILIKE '%사과%' OR biz_sector ILIKE '%포도%'`,
      )
      .limit(10)) as Array<{ name: string; biz_sector: string | null; intro: string | null }>;
    console.log('biz_sector 매칭 농가:', samples.length, '건');
    samples.forEach((s, i) => {
      console.log(`${i + 1}. ${s.name} | sector="${s.biz_sector}"`);
    });
    // intro_html 검색도
    const introSamples = (await tx
      .select({
        name: vendors.biz_name,
      })
      .from(vendors)
      .where(sql`intro_html ILIKE '%참외%'`)
      .limit(10)) as Array<{ name: string }>;
    console.log('\nintro_html 에 참외 매칭:', introSamples.length, '건');
    introSamples.slice(0, 5).forEach((s, i) => console.log(`${i + 1}. ${s.name}`));
  });
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
