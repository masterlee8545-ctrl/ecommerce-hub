#!/usr/bin/env node
/**
 * sello:login — 셀록홈즈 수동 OAuth 로그인 헬퍼.
 *
 * 동작:
 * 1. Chrome 을 visible 모드로 열어 `C:\sello-user-data` 프로필에 연결
 * 2. 셀록홈즈 메인 페이지로 이동
 * 3. 2초마다 URL 폴링 — 현재 URL 이 `/auth/login` 아니면서 sellochomes.co.kr 안이면 성공 판정
 * 4. 성공 시 Chrome 자동 종료, 쿠키는 프로필에 저장됨
 * 5. 이후 `npm run sello:worker` 가 새 세션으로 스크래핑 가능
 *
 * 사용:
 *   npm run sello:login
 *
 * 사용자 액션:
 *   Chrome 창이 열리면 "구글로 시작하기" 또는 "카카오로 시작하기" 클릭 → 계정 로그인
 *   (스크립트가 자동으로 완료 감지 후 창 닫음)
 *
 * 타임아웃: 10분
 */
import { chromium, type BrowserContext } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const DEFAULT_USER_DATA = 'C:\\sello-user-data';
const DEFAULT_PROFILE_DIR = 'Default';
const TARGET_URL = 'https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword';
const POLL_INTERVAL_MS = 2000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10분

async function resolveExtensionPath(inputPath: string): Promise<string | null> {
  try {
    await fs.access(path.join(inputPath, 'manifest.json'));
    return inputPath;
  } catch {
    // 버전 폴더 자동 탐색
    const parent = path.dirname(inputPath);
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse();
      for (const v of dirs) {
        const candidate = path.join(parent, v);
        try {
          await fs.access(path.join(candidate, 'manifest.json'));
          return candidate;
        } catch { /* continue */ }
      }
    } catch { /* no parent */ }
  }
  return null;
}

async function main(): Promise<void> {
  const userDataDir = process.env['SELLO_USER_DATA_DIR'] ?? DEFAULT_USER_DATA;
  const profileDir = process.env['SELLO_PROFILE_DIR'] ?? DEFAULT_PROFILE_DIR;
  const extPathRaw = process.env['SELLO_EXTENSION_PATH'];
  const extPath = extPathRaw ? await resolveExtensionPath(extPathRaw) : null;

  console.log(`[login] Chrome 시작...`);
  console.log(`[login] profile: ${userDataDir}\\${profileDir}`);
  if (extPath) console.log(`[login] extension: ${extPath}`);

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: null,
      ignoreDefaultArgs: [
        '--enable-automation',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
      args: [
        `--profile-directory=${profileDir}`,
        ...(extPath ? [`--load-extension=${extPath}`] : []),
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-first-run',
        '--restore-last-session=false',
        '--disable-session-crashed-bubble',
        '--start-maximized',
      ],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n[login] ❌ Chrome 실행 실패: ${msg}`);
    console.error(`\n조치:`);
    console.error(`  1) 열려 있는 모든 Chrome 창 종료 (taskkill /F /IM chrome.exe)`);
    console.error(`  2) BUYWISE sello:scrape / sello:worker 동시 실행 금지`);
    process.exit(1);
  }

  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.bringToFront();

  console.log(`[login] 목적지: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  🔐 Chrome 창에서 로그인해주세요`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  1. 화면에 뜬 Chrome 창 확인`);
  console.log(`  2. "구글로 시작하기" 또는 "카카오로 시작하기" 클릭`);
  console.log(`  3. 계정 비밀번호 입력 → 로그인 완료`);
  console.log(`  (완료되면 자동 감지해서 Chrome 종료합니다)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let lastUrl = '';
  while (Date.now() < deadline) {
    const url = page.url();
    if (url !== lastUrl) {
      console.log(`[login] URL: ${url}`);
      lastUrl = url;
    }
    // 성공 조건: sellochomes.co.kr 안에서 /auth/login 아닌 페이지
    if (
      url.includes('sellochomes.co.kr')
      && !url.includes('/auth/login')
      && !url.includes('/signin')
    ) {
      // 추가 검증: 검색 입력이 보이면 로그인된 상태
      const hasSearchInput = await page
        .evaluate(`!!document.querySelector('input.search-input')`)
        .catch(() => false);
      if (hasSearchInput) {
        console.log(`\n[login] ✅ 로그인 완료 감지! 쿠키가 프로필에 저장됨.`);
        await context.close();
        console.log(`[login] 이제 \`npm run sello:worker\` 로 스크래핑 가능.`);
        process.exit(0);
      }
    }
    await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => {});
  }

  console.error(`\n[login] ⏱ 타임아웃 (10분) — 다시 시도해주세요.`);
  await context.close().catch(() => {});
  process.exit(2);
}

main().catch((e: unknown) => {
  console.error(`[login] 크래시:`, e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
