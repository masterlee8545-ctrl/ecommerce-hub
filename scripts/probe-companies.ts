#!/usr/bin/env node
/**
 * 현재 DB 에 등록된 companies 목록과 admin 유저의 멤버십을 출력.
 * 용도: 3법인 시드가 제대로 들어갔는지 빠르게 확인.
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { companies, userCompanies, users } from '../src/db/schema';

(async () => {
  const allCompanies = await db.select().from(companies);
  console.log(`[companies] 총 ${allCompanies.length}개:`);
  for (const c of allCompanies) {
    console.log(`  - ${c.name}  (${c.business_type})  id=${c.id.slice(0, 8)}`);
  }

  const adminRows = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@buywise.co'))
    .limit(1);
  const admin = adminRows[0];
  if (!admin) {
    console.log('\n[admin] admin@buywise.co 없음 — seed 필요');
    process.exit(0);
  }

  const memberships = await db
    .select({
      companyName: companies.name,
      role: userCompanies.role,
    })
    .from(userCompanies)
    .innerJoin(companies, eq(companies.id, userCompanies.company_id))
    .where(eq(userCompanies.user_id, admin.id));

  console.log(`\n[admin membership] ${memberships.length}개:`);
  for (const m of memberships) {
    console.log(`  - ${m.companyName}  (${m.role})`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
