#!/usr/bin/env node
/**
 * 직원 계정 발급 CLI (Phase C)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/create-staff-account.ts \
 *     --email plan@buywise.co \
 *     --name "김기획" \
 *     --role manager \
 *     --companies "바이와이즈,유어밸류"
 *
 * 옵션:
 *   --email       이메일 (필수, 소문자 정규화)
 *   --name        표시 이름 (필수)
 *   --role        owner|manager|operator (필수, 모든 법인에 동일 적용)
 *   --companies   소속 법인 이름 또는 "all" (쉼표 구분, 필수)
 *   --password    초기 비번 (생략 시 랜덤 12자 생성 후 출력)
 *
 * 멱등성:
 *   - 같은 이메일이 이미 있으면 비번/이름 갱신하고 법인 멤버십만 추가.
 *   - 이미 같은 법인에 멤버십 있으면 skip (역할 변경은 안 함 — 안전장치).
 *
 * 헌법: CLAUDE.md §1 P-7 (평문 저장 금지), §1 P-4 (멀티테넌트)
 */
import { randomBytes } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../src/db';
import { companies, userCompanies, users } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth/password';

type Role = 'owner' | 'manager' | 'operator';

interface Args {
  email: string;
  name: string;
  role: Role;
  companies: string[]; // 법인 이름 배열 or ['all']
  password: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const m: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        m[key] = val;
        i++;
      }
    }
  }

  const required = ['email', 'name', 'role', 'companies'];
  for (const k of required) {
    if (!m[k]) {
      console.error(`[create-staff] --${k} 필수`);
      process.exit(1);
    }
  }

  if (!['owner', 'manager', 'operator'].includes(m.role!)) {
    console.error(`[create-staff] --role 은 owner|manager|operator 중 하나`);
    process.exit(1);
  }

  return {
    email: m.email!.trim().toLowerCase(),
    name: m.name!.trim(),
    role: m.role! as Role,
    companies: m.companies! === 'all' ? ['all'] : m.companies!.split(',').map((s) => s.trim()).filter(Boolean),
    password: m.password,
  };
}

function generatePassword(): string {
  // 12자 영숫자 + 심볼 (URL-safe, 복붙 쉬움)
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const plainPassword = args.password ?? generatePassword();

  // 법인 ID 조회
  const allCompanyRows = await db.select({ id: companies.id, name: companies.name }).from(companies);
  const targetCompanies =
    args.companies[0] === 'all'
      ? allCompanyRows
      : allCompanyRows.filter((c) => args.companies.includes(c.name));

  if (targetCompanies.length === 0) {
    console.error(`[create-staff] 법인을 찾을 수 없음: ${args.companies.join(', ')}`);
    console.error(`  사용 가능: ${allCompanyRows.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  if (args.companies[0] !== 'all' && targetCompanies.length !== args.companies.length) {
    const foundNames = targetCompanies.map((c) => c.name);
    const missing = args.companies.filter((n) => !foundNames.includes(n));
    console.error(`[create-staff] 일부 법인 누락: ${missing.join(', ')}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(plainPassword);

  // upsert 사용자
  const existing = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, args.email))
    .limit(1);

  let userId: string;
  let userCreated = false;
  if (existing[0]) {
    userId = existing[0].id;
    await db
      .update(users)
      .set({
        name: args.name,
        password_hash: passwordHash,
        is_active: true,
        updated_at: new Date(),
      })
      .where(eq(users.id, userId));
  } else {
    const firstCompanyId = targetCompanies[0]!.id;
    const inserted = await db
      .insert(users)
      .values({
        email: args.email,
        name: args.name,
        password_hash: passwordHash,
        active_company_id: firstCompanyId,
        is_active: true,
      })
      .returning({ id: users.id });
    const newId = inserted[0]?.id;
    if (!newId) throw new Error('[create-staff] 사용자 INSERT 실패');
    userId = newId;
    userCreated = true;
  }

  // 멤버십 upsert — 이미 있으면 skip (역할 변경 안 함)
  const existingMembership = await db
    .select({ company_id: userCompanies.company_id })
    .from(userCompanies)
    .where(
      and(
        eq(userCompanies.user_id, userId),
        inArray(
          userCompanies.company_id,
          targetCompanies.map((c) => c.id),
        ),
      ),
    );
  const existingCompanyIds = new Set(existingMembership.map((r) => r.company_id));

  const newMemberships: string[] = [];
  for (const c of targetCompanies) {
    if (existingCompanyIds.has(c.id)) continue;
    await db.insert(userCompanies).values({
      user_id: userId,
      company_id: c.id,
      role: args.role,
    });
    newMemberships.push(c.name);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${userCreated ? '✅ 신규 계정 발급 완료' : '🔄 기존 계정 업데이트'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  이메일:        ${args.email}`);
  console.log(`  이름:          ${args.name}`);
  console.log(`  역할:          ${args.role}`);
  console.log(`  신규 멤버십:   ${newMemberships.length > 0 ? newMemberships.join(', ') : '(없음 — 이미 전부 등록)'}`);
  if (existingCompanyIds.size > 0) {
    console.log(`  기존 멤버십:   ${targetCompanies.filter((c) => existingCompanyIds.has(c.id)).map((c) => c.name).join(', ')} (역할 변경 없음)`);
  }
  console.log('');
  console.log(`  🔑 초기 비밀번호 (한 번만 표시):`);
  console.log(`     ${plainPassword}`);
  console.log('');
  console.log(`  📡 로그인: https://ecommerce-hub-bwzkr.vercel.app/login`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  process.exit(0);
})().catch((err) => {
  console.error('[create-staff] 실패:', err);
  process.exit(1);
});
