#!/usr/bin/env node
/**
 * 임의 사용자용 MCP 토큰 발급 (admin 이외)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/issue-mcp-token-for.ts \
 *     --email smoke-operator@buywise.co \
 *     --label "phase-c operator smoke"
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { users } from '../src/db/schema';
import { issueMcpToken } from '../src/lib/mcp/auth';

function parseArgs(argv: string[]): { email: string; label: string } {
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
  if (!m.email || !m.label) {
    console.error('[issue-mcp-token-for] --email 과 --label 필수');
    process.exit(1);
  }
  return { email: m.email.trim().toLowerCase(), label: m.label };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const rows = await db.select().from(users).where(eq(users.email, args.email)).limit(1);
  const user = rows[0];
  if (!user?.active_company_id) {
    console.error(`[issue-mcp-token-for] 사용자 없음 또는 active_company 미설정: ${args.email}`);
    process.exit(1);
  }

  const { plainToken } = await issueMcpToken({
    userId: user.id,
    companyId: user.active_company_id,
    label: args.label,
  });

  console.log('');
  console.log(`토큰: ${plainToken}`);
  console.log('');
  process.exit(0);
})().catch((err) => {
  console.error('[issue-mcp-token-for] 실패:', err);
  process.exit(1);
});
