#!/usr/bin/env node
/**
 * 관리자 MCP 토큰 발급 스크립트.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/issue-mcp-token.ts "Claude.ai laptop"
 *
 * 반환된 토큰은 한 번만 표시됨 — 안전한 곳에 저장 후 Claude.ai 에 입력.
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { users } from '../src/db/schema';
import { issueMcpToken } from '../src/lib/mcp/auth';

const ADMIN_EMAIL = 'admin@buywise.co';
const label = process.argv[2] ?? 'Claude.ai';

(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const admin = rows[0];
  if (!admin?.active_company_id) throw new Error('admin 없음');

  const { token, plainToken } = await issueMcpToken({
    userId: admin.id,
    companyId: admin.active_company_id,
    label,
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ MCP 토큰 발급 완료');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  라벨:    ${token.label}`);
  console.log(`  ID:      ${token.id.slice(0, 12)}...`);
  console.log(`  공개 prefix: ${token.token_prefix}...`);
  console.log('');
  console.log('  🔑 토큰 (한 번만 표시):');
  console.log(`     ${plainToken}`);
  console.log('');
  console.log('  📡 MCP URL:');
  console.log('     https://ecommerce-hub-bwzkr.vercel.app/api/mcp');
  console.log('');
  console.log('  🧪 테스트:');
  console.log(`     curl -X POST https://ecommerce-hub-bwzkr.vercel.app/api/mcp \\`);
  console.log(`       -H "Authorization: Bearer ${plainToken}" \\`);
  console.log(`       -H "Content-Type: application/json" \\`);
  console.log(`       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
