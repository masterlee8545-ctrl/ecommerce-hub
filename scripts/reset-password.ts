#!/usr/bin/env node
/**
 * 직원 비밀번호 재설정 CLI (Phase C)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/reset-password.ts --email plan@buywise.co
 *   npx tsx --env-file=.env.local scripts/reset-password.ts --email plan@buywise.co --password NewPass123
 *
 * 옵션:
 *   --email     재설정할 계정 이메일 (필수)
 *   --password  새 비번 (생략 시 랜덤 12자)
 *
 * 헌법: CLAUDE.md §1 P-7 (평문 저장 금지, 한 번만 표시)
 */
import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { users } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth/password';

function parseArgs(argv: string[]): { email: string; password: string | undefined } {
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
  if (!m.email) {
    console.error('[reset-password] --email 필수');
    process.exit(1);
  }
  return { email: m.email.trim().toLowerCase(), password: m.password };
}

function generatePassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const plainPassword = args.password ?? generatePassword();

  const existing = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, args.email)).limit(1);
  if (!existing[0]) {
    console.error(`[reset-password] 계정 없음: ${args.email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(plainPassword);
  await db
    .update(users)
    .set({ password_hash: passwordHash, is_active: true, updated_at: new Date() })
    .where(eq(users.id, existing[0].id));

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ 비밀번호 재설정 완료');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  이메일:  ${args.email}`);
  console.log(`  이름:    ${existing[0].name}`);
  console.log(`  🔑 새 비밀번호 (한 번만 표시):`);
  console.log(`     ${plainPassword}`);
  console.log(`  📡 로그인: https://ecommerce-hub-bwzkr.vercel.app/login`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  process.exit(0);
})().catch((err) => {
  console.error('[reset-password] 실패:', err);
  process.exit(1);
});
