#!/usr/bin/env node
/**
 * .env.local → Vercel 환경변수 일괄 업로드.
 *
 * 스킵:
 * - SELLO_* (로컬 워커 전용)
 * - NODE_ENV, NEXT_PUBLIC_APP_ENV (Vercel 이 자동 설정)
 * - NEXTAUTH_URL (배포 후 실제 URL 로 별도 설정)
 *
 * 사용: npx tsx scripts/push-env-to-vercel.ts
 */
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const SKIP_PREFIX = ['SELLO_', 'NEXT_PUBLIC_APP_ENV', 'NODE_ENV'];
const SKIP_KEYS = ['NEXTAUTH_URL']; // 배포 후 개별 세팅

async function main(): Promise<void> {
  const path = join(process.cwd(), '.env.local');
  const raw = await readFile(path, 'utf-8');

  const vars: Array<{ key: string; value: string }> = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    // 따옴표 제거
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || !value) continue;
    if (SKIP_PREFIX.some((p) => key.startsWith(p))) continue;
    if (SKIP_KEYS.includes(key)) continue;
    vars.push({ key, value });
  }

  console.log(`[env] ${vars.length}개 변수 업로드 시작`);

  let ok = 0, failed = 0, skipped = 0;
  for (const { key, value } of vars) {
    try {
      // Vercel 은 existing 변수면 실패 — rm + add 조합
      // 우선 add 만 — 실패하면 rm+add
      execSync(`echo "${value.replace(/"/g, '\\"')}" | vercel env add ${key} production`, {
        stdio: 'pipe',
        shell: 'bash' as unknown as string,
      });
      console.log(`  ✓ ${key}`);
      ok++;
    } catch (e) {
      const msg = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
      if (msg.includes('already exists')) {
        // 이미 있으면 일단 skip (필요하면 rm 후 add)
        console.log(`  • ${key} (already exists, skipped)`);
        skipped++;
      } else {
        console.error(`  ✗ ${key}: ${msg.slice(0, 100)}`);
        failed++;
      }
    }
  }

  console.log(`\n[env] 완료: ${ok} 신규, ${skipped} 이미존재, ${failed} 실패`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
