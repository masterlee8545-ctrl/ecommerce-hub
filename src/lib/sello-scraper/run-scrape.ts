/**
 * 셀록홈즈 쿠팡 키워드 스크래퍼 — 인프로세스 함수 버전.
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-2 (실패 시 명시 에러)
 *
 * 역할:
 * - `scripts/sello-scraper/scrape.ts` 의 로직을 함수로 추출.
 * - API 라우트에서 직접 호출 가능 (서버사이드 Playwright).
 * - CLI(`npm run sello:scrape`) 와 로직 공유.
 *
 * 제약:
 * - **Windows + Chrome 로컬 환경 전용** (Vercel 등 서버리스 불가).
 * - 실행 중 다른 Chrome 창(혹은 BUYWISE sello:scrape) 이 프로필을 잠그고 있으면 실패.
 * - 셀록홈즈 로그인이 프로필에 이미 저장되어 있어야 함
 *   (`C:\sello-user-data\Default` — 최초 1회 CLI 실행으로 세팅).
 * - 쿠팡 윙 로그인은 **필요 없음** (스크래핑 대상은 sellochomes.co.kr).
 *
 * 동시성:
 * - 같은 프로필을 두 번 launch 하면 락 충돌 → globalThis 싱글톤 lock 사용.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, type BrowserContext, type Page } from 'playwright';

// 배럴 대신 페이지 어댑터만 가져온다 — 배럴은 금고(→DB)까지 끌고 오는데
// 이 스크래퍼는 DB 를 쓰지 않는다.
import {
  checkSelectorOnPage,
  clickByContractOrThrow,
  CrawlContractError,
  extractRowsFromPage,
  fillByRegistry,
  healSelectorOnPage,
  waitForContract,
  type ExtractedRow,
  type RowExtractionPlan,
} from '@/lib/crawl/page';

import type { SelloScrapedJson, SelloScrapedRow } from './adapter';

const DEFAULT_USER_DATA = 'C:\\sello-user-data';
const DEFAULT_PROFILE_DIR = 'Default';
const PAGE_URL = 'https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword';

// ── 풀(full) 모드: 셀러라이프 확장이 판매량/조회수까지 채울 때까지 대기 (~3분)
const COLLECTION_TIMEOUT_MS = 180_000;
const TARGET_ROWS = 20;
const MIN_FILLED = 18;

// ── 패스트(fast) 모드: 리뷰만 가져옴 (~10~20초) — 리뷰 분포 분석용
//    review 값은 페이지 렌더 시 즉시 HTML 에 박혀있어 확장 fill 불필요
const FAST_TIMEOUT_MS = 30_000;
const FAST_MIN_WITH_REVIEWS = 18;

// ─────────────────────────────────────────────────────────
// 싱글톤 락 — 동시 실행 차단
// ─────────────────────────────────────────────────────────

declare global {
  var __selloScrapeLock: { keyword: string; startedAt: number } | null | undefined;
}

function acquireLock(keyword: string): boolean {
  if (globalThis.__selloScrapeLock) {
    const lock = globalThis.__selloScrapeLock;
    const age = Date.now() - lock.startedAt;
    // 10분 이상 된 락은 stale 로 간주하고 덮어씀 (크래시 잔재)
    const STALE_AGE_MS = 600_000;
    if (age < STALE_AGE_MS) return false;
  }
  globalThis.__selloScrapeLock = { keyword, startedAt: Date.now() };
  return true;
}

function releaseLock(): void {
  globalThis.__selloScrapeLock = null;
}

export function getCurrentScrapeLock(): { keyword: string; startedAt: number } | null {
  return globalThis.__selloScrapeLock ?? null;
}

/**
 * 확장 프로그램 경로 해결.
 *
 * - 입력 경로에 manifest.json 이 있으면 그대로 반환 (정확 버전 지정)
 * - 없으면 그 상위(확장 ID 폴더) 로 간주하고 하위 버전 폴더 중 최신을 선택
 *   — Chrome 자동 업데이트로 버전 폴더가 바뀌어도 동작
 * - 어느 쪽도 실패하면 null
 */
async function resolveExtensionPath(inputPath: string): Promise<string | null> {
  const directManifest = path.join(inputPath, 'manifest.json');
  try {
    await fs.access(directManifest);
    return inputPath;
  } catch {
    // manifest 없음 → 부모로 올라가서 버전 탐색
  }

  // 부모 폴더(= 확장 ID) 에서 최신 버전 탐색
  // 1.2.1.37_0 vs 1.2.1.35_0 같은 폴더명 → 사전순 내림차순 (semantic 아님, Chrome 관행)
  const parentDir = path.dirname(inputPath);
  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const versionDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const v of versionDirs) {
      const candidate = path.join(parentDir, v);
      try {
        await fs.access(path.join(candidate, 'manifest.json'));
        return candidate;
      } catch {
        // 다음 후보
      }
    }
  } catch {
    // parent 자체가 없음
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 공개 타입
// ─────────────────────────────────────────────────────────

export type ScrapeResult =
  | { ok: true; json: SelloScrapedJson; jsonPath: string }
  | {
      ok: false;
      reason:
        | 'login-required'
        | 'locked'
        | 'launch-failed'
        | 'timeout'
        | 'contract'
        | 'other';
      error: string;
    };

// ─────────────────────────────────────────────────────────
// 레지스트리 연동 (ADR-014)
// ─────────────────────────────────────────────────────────
//
// 이 파일에는 셀록홈즈 셀렉터 문자열이 하나도 없다. 전부
// `src/lib/crawl/selectors.json` 에 계약과 함께 들어 있다.
// 화면이 바뀌면 고칠 곳이 한 군데이고, 자동 치유가 성공하면 코드 수정 없이 이어진다.
//
// 파싱도 브라우저가 아니라 Node 에서 한다 — `page.evaluate` 안에 로직을 두면
// tsx/esbuild 의 `__name` 래퍼 문제를 피하려고 타입 없는 문자열로 적어야 했고,
// 그 결과 같은 파서가 scrape.ts 에 복제돼 서로 어긋나 있었다.

/** 표 한 행에서 무엇을 뽑을지. 값은 전부 레지스트리 셀렉터 id 다. */
const SELLO_ROW_PLAN: RowExtractionPlan = {
  rowSelectorId: 'sello.row',
  rowAttrs: ['data-rank', 'data-coupangid', 'data-itemid', 'data-sourcing-monthly-amount'],
  fields: {
    name: { selectorId: 'sello.row_name' },
    price: { selectorId: 'sello.row_price' },
    review: { selectorId: 'sello.row_review' },
    pvMonth: { selectorId: 'sello.row_pv_month' },
    sales: { selectorId: 'sello.row_sales' },
    salesMonth: { selectorId: 'sello.row_sales_month' },
    cvMonth: { selectorId: 'sello.row_cv_month' },
    sourcingPrice: { selectorId: 'sello.row_sourcing_price' },
    expectedAmount: { selectorId: 'sello.row_expected_amount' },
    expectedPriceRate: { selectorId: 'sello.row_expected_price_rate' },
    imageUrl: { selectorId: 'sello.row_image', attr: 'src' },
    productUrl: { selectorId: 'sello.row_link', attr: 'href' },
  },
  flags: { isRocketDelivery: 'sello.row_rocket' },
};

/** 추출 결과를 기존 JSON 포맷으로 옮긴다. 저장 포맷은 바꾸지 않는다. */
function toScrapedRow(row: ExtractedRow): SelloScrapedRow {
  return {
    rank: row.attrs['data-rank'] ?? null,
    coupangId: row.attrs['data-coupangid'] ?? null,
    itemId: row.attrs['data-itemid'] ?? null,
    sourcingMonthlyAmount: row.attrs['data-sourcing-monthly-amount'] ?? null,
    name: row.fields['name'] ?? null,
    price: row.fields['price'] ?? null,
    review: row.fields['review'] ?? null,
    pvMonth: row.fields['pvMonth'] ?? null,
    sales: row.fields['sales'] ?? null,
    salesMonth: row.fields['salesMonth'] ?? null,
    cvMonth: row.fields['cvMonth'] ?? null,
    sourcingPrice: row.fields['sourcingPrice'] ?? null,
    expectedAmount: row.fields['expectedAmount'] ?? null,
    expectedPriceRate: row.fields['expectedPriceRate'] ?? null,
    imageUrl: row.fields['imageUrl'] ?? null,
    productUrl: row.fields['productUrl'] ?? null,
    isRocketDelivery: row.flags['isRocketDelivery'] === true,
  };
}

async function parseRows(page: Page): Promise<SelloScrapedRow[]> {
  const rows = await extractRowsFromPage(page, SELLO_ROW_PLAN);
  return rows.map(toScrapedRow);
}

/**
 * 확장이 채우는 칸(월 조회수)이 실제로 채워진 행 수.
 *
 * 예전에는 종료 조건과 최종 파싱이 서로 다른 `page.evaluate` 를 돌려, 원리상
 * 다른 행 집합을 볼 수 있었다. 이제 둘 다 같은 추출 결과를 센다.
 */
function countFilled(rows: SelloScrapedRow[]): { total: number; filled: number } {
  let filled = 0;
  for (const row of rows) {
    const raw = (row.pvMonth ?? '').trim();
    if (raw && /\d/.test(raw) && raw !== '-' && raw !== '0') filled += 1;
  }
  return { total: rows.length, filled };
}

/** 리뷰가 채워진 행 수 — fast 모드 종료 조건. review 는 0 도 정상값이다 (신상품). */
function countWithReviews(rows: SelloScrapedRow[]): { total: number; withReviews: number } {
  let withReviews = 0;
  for (const row of rows) {
    const raw = (row.review ?? '').trim();
    if (raw && raw !== '-') withReviews += 1;
  }
  return { total: rows.length, withReviews };
}

// ─────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────

/**
 * 키워드를 받아 셀록홈즈에서 쿠팡 1페이지 상품을 스크랩하고 JSON 파일로 저장.
 *
 * @param keyword 검색어
 * @param options.outputDir 결과 JSON 저장 위치 (기본: cwd/data/sello-scrape)
 * @param options.onProgress 진행 상황 콜백 (로그 문자열)
 * @returns 스크랩 결과 + 저장된 JSON 경로
 */
export async function runSelloScrape(
  keyword: string,
  options?: {
    outputDir?: string;
    onProgress?: (msg: string) => void;
    signal?: AbortSignal;
    /**
     * 창 표시 모드.
     * - 'visible'   — 기존 동작, Chrome 창 뜸
     * - 'minimized' — 창은 뜨지만 최소화 (작업 표시줄에만)
     * - 'offscreen' — 화면 밖 (-32000, -32000) 으로 배치 — 사실상 숨김
     * - 'headless'  — Chrome new headless mode (GUI 없음, 확장도 동작)
     *
     * 기본값: SELLO_SCRAPE_MODE env (없으면 'offscreen' — 성능·UX 균형)
     */
    mode?: 'visible' | 'minimized' | 'offscreen' | 'headless';
    /**
     * fast 모드 — 리뷰만 가져오고 즉시 종료 (~10~20초/키워드).
     *
     * 기본값: false (기존 동작 유지 — 판매량/조회수까지 ~3분 대기).
     *
     * true 설정 시:
     * - 셀러라이프 확장이 채우는 pv-month/sales/cv-month 안 기다림
     * - 검색 후 18/20 row 의 review 만 채워지면 즉시 parse 후 종료
     * - 결과 JSON 의 pvMonth/sales/cvMonth 필드는 "-" 로 남음
     *
     * 용도: 카테고리 리뷰 분포 분석 (500미만 비율 등) — 리뷰 외 디테일 불필요할 때.
     */
    fastMode?: boolean;
  },
): Promise<ScrapeResult> {
  const trimmedKw = keyword.trim();
  if (!trimmedKw) {
    return { ok: false, reason: 'other', error: '키워드가 비어있습니다.' };
  }

  // Vercel/Linux serverless 에서는 Playwright + Chrome + 확장 프로그램 조합이
  // 동작하지 않음 → 명시적 에러로 사용자에게 배치 큐 사용을 유도
  if (process.platform !== 'win32') {
    return {
      ok: false,
      reason: 'launch-failed',
      error:
        `이 스크래퍼는 Windows 로컬 환경 전용입니다 (현재 플랫폼: ${process.platform}). ` +
        `Vercel 같은 서버리스에서는 동작하지 않습니다. ` +
        `로컬 PC 에서 \`npm run sello:worker\` 를 실행하고 배치 분석을 통해 간접 사용하세요.`,
    };
  }

  const log = (msg: string): void => {
    options?.onProgress?.(msg);
    console.warn(`[sello-scrape] ${msg}`);
  };

  // ── 싱글톤 락 확보 ──────────────────────────────────────
  if (!acquireLock(trimmedKw)) {
    const cur = getCurrentScrapeLock();
    return {
      ok: false,
      reason: 'locked',
      error: `이미 다른 스크래핑이 진행 중입니다: "${cur?.keyword}" (${cur ? Math.round((Date.now() - cur.startedAt) / 1000) : 0}초 경과). 완료 후 다시 시도하세요.`,
    };
  }

  const outputDir =
    options?.outputDir ?? path.join(process.cwd(), 'data', 'sello-scrape');
  await fs.mkdir(outputDir, { recursive: true });

  const userDataDir = process.env['SELLO_USER_DATA_DIR'] ?? DEFAULT_USER_DATA;
  const profileDir = process.env['SELLO_PROFILE_DIR'] ?? DEFAULT_PROFILE_DIR;
  const extensionPathRaw = process.env['SELLO_EXTENSION_PATH'];

  if (!extensionPathRaw) {
    releaseLock();
    return {
      ok: false,
      reason: 'other',
      error:
        'SELLO_EXTENSION_PATH 환경변수가 없습니다. .env.local 에 설정하세요.',
    };
  }

  // 버전 폴더 자동 탐지 — Chrome 확장이 자동 업데이트돼 버전이 바뀌어도 동작하도록
  const extensionPath = await resolveExtensionPath(extensionPathRaw);
  if (!extensionPath) {
    releaseLock();
    return {
      ok: false,
      reason: 'other',
      error:
        `셀러라이프 확장을 찾을 수 없습니다: ${extensionPathRaw}\n` +
        `Chrome 에서 확장이 설치돼 있는지, 경로가 맞는지 확인하세요.`,
    };
  }
  log(`extension: ${extensionPath}`);
  log(`keyword="${trimmedKw}" profile="${profileDir}"`);

  // 창 표시 모드 결정 — 옵션 > env > 기본
  //
  // 기본값을 'visible' 로 정한 이유:
  //   - 'offscreen' 은 sellochomes anti-bot 걸려 간헐적으로 /auth/login 으로 redirect
  //   - 'headless' 는 확장 프로그램 로딩 실패
  //   - 'minimized' 는 일부 OS 에서 backgrounding 되어 JS 렌더 지연
  // 'visible' 이 가장 안정적. Chrome 창이 잠깐 떴다 사라지는 걸 감수.
  //
  // 안정성 검증된 키워드 "양말"(207s) / "장갑"(193s) / 복숭아(189s-어제).
  type ScrapeMode = 'visible' | 'minimized' | 'offscreen' | 'headless';
  const envMode = process.env['SELLO_SCRAPE_MODE'] as ScrapeMode | undefined;
  const mode: ScrapeMode = options?.mode ?? envMode ?? 'visible';
  log(`mode: ${mode}`);

  // 모드별 args 생성
  const windowArgs: string[] = [];
  let useHeadless: boolean | 'new' = false;
  if (mode === 'headless') {
    useHeadless = 'new';
  } else if (mode === 'minimized') {
    windowArgs.push('--start-minimized', '--window-position=-32000,-32000');
  } else if (mode === 'offscreen') {
    // 화면 밖에 뜨고 크기는 유지 — 사용자 눈에 안 보이지만 headless 디텍션 피함
    windowArgs.push('--window-position=-32000,-32000', '--window-size=1400,900');
  } else {
    windowArgs.push('--start-maximized');
  }

  let context: BrowserContext | null = null;
  try {
    // ── Chrome persistent context launch ────────────────
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: useHeadless === 'new' ? true : false, // Playwright 는 boolean 만, --headless=new 는 아래 args 로
        viewport: null,
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
        ],
        args: [
          `--profile-directory=${profileDir}`,
          `--load-extension=${extensionPath}`,
          '--disable-blink-features=AutomationControlled',
          '--no-default-browser-check',
          '--no-first-run',
          '--restore-last-session=false',
          '--disable-session-crashed-bubble',
          ...(useHeadless === 'new' ? ['--headless=new'] : []),
          ...windowArgs,
        ],
      });
      await context.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: function () { return undefined; } });
      `);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      releaseLock();
      return {
        ok: false,
        reason: 'launch-failed',
        error:
          `Chrome 실행 실패: ${msg}\n\n` +
          `조치:\n` +
          `  1) 열려 있는 모든 Chrome 창 완전히 종료\n` +
          `  2) BUYWISE sello:scrape 동시 실행 금지\n` +
          `  3) 프로필 경로 확인: ${userDataDir}`,
      };
    }

    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    // 포커스 가로채지 않음 — mode 가 visible 일 때만 전면에
    if (mode === 'visible') {
      await page.bringToFront();
    }

    log(`nav: ${PAGE_URL}`);
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/auth/login') || currentUrl.includes('/signin')) {
      // API 모드에서는 대화식 로그인 대기 불가능 — 명시적 에러
      await context.close().catch(() => {});
      releaseLock();
      return {
        ok: false,
        reason: 'login-required',
        error:
          '셀록홈즈 로그인이 필요합니다. 터미널에서 아무 키워드로 `npm run sello:scrape -- 테스트` 한 번 실행 → 열린 Chrome 에서 로그인 → 다시 시도하세요.',
      };
    }

    await page.waitForTimeout(2000);

    // ── 검색 UI 준비 ────────────────────────────────────
    // 60s — sellochomes 초기 로딩이 가끔 25~30s 걸림. 여유 있게.
    const SEARCH_READY_TIMEOUT_MS = 60_000;
    const SEARCH_POLL_MS = 1_500;
    try {
      await waitForContract(page, 'sello.search_input', {
        timeoutMs: SEARCH_READY_TIMEOUT_MS,
        pollMs: SEARCH_POLL_MS,
        onProgress: log,
      });
    } catch (waitErr) {
      // 실패 — URL 이 /auth/login 으로 client-side redirect 됐는지 재체크
      const urlAfterWait = page.url();
      if (
        urlAfterWait.includes('/auth/login')
        || urlAfterWait.includes('/signin')
      ) {
        await context.close().catch(() => {});
        releaseLock();
        return {
          ok: false,
          reason: 'login-required',
          error:
            '셀록홈즈 세션이 만료되었습니다 (OAuth 쿠키 expired). ' +
            '터미널에서 `npm run sello:scrape -- 테스트` 실행 → 열리는 Chrome 에서 ' +
            '구글 또는 카카오로 수동 로그인 → 완료 후 재시도.',
        };
      }
      // 정말 다른 이유로 검색칸이 없음 — 진단 덤프
      const debugShot = path.join(outputDir, `_debug-no-input-${Date.now()}.png`);
      await page.screenshot({ path: debugShot, fullPage: true }).catch(() => {});
      log(`❌ 검색칸 계약 실패. url=${urlAfterWait}`);
      log(`   ${waitErr instanceof Error ? waitErr.message : String(waitErr)}`);
      log(`   스크린샷: ${debugShot}`);
      await context.close().catch(() => {});
      releaseLock();
      return {
        ok: false,
        reason: 'contract',
        error:
          '셀록홈즈 검색 화면을 찾지 못했습니다 (화면 구조 변경 가능). ' +
          `진단 스크린샷: ${debugShot}. ` +
          'data/crawl-snapshots/ 와 docs/CRAWL_REGISTRY.md 를 확인하세요.',
      };
    }

    await fillByRegistry(page, 'sello.search_input', trimmedKw);

    // 분석 범위 드롭다운 — "1 페이지 상품분석"
    //
    // 예전에는 이 두 클릭의 성공 여부를 확인하지 않아, 버튼을 못 찾아도 조용히
    // 넘어간 뒤 엉뚱한 범위의 결과를 수집했다. 이제 못 누르면 즉시 실패한다.
    const DROPDOWN_OPEN_WAIT_MS = 800;
    const DROPDOWN_PICK_WAIT_MS = 500;
    try {
      // 드롭다운은 원래 in-page element.click() 이었다 — Playwright 기본 클릭의
      // 가시성·안정성 대기를 새로 끼워 넣으면 없던 실패가 생긴다.
      await clickByContractOrThrow(page, 'sello.page_select_trigger', { programmatic: true });
      await page.waitForTimeout(DROPDOWN_OPEN_WAIT_MS);
      await clickByContractOrThrow(page, 'sello.page_select_option', { programmatic: true });
      await page.waitForTimeout(DROPDOWN_PICK_WAIT_MS);
      log('검색 트리거 (1페이지 분석)');
      // 검색 버튼은 원래도 page.click() 이었다 — 실제 클릭 그대로 둔다
      await clickByContractOrThrow(page, 'sello.search_button');
    } catch (clickErr) {
      const message = clickErr instanceof Error ? clickErr.message : String(clickErr);
      log(`❌ 검색 조작 실패: ${message}`);
      await context.close().catch(() => {});
      releaseLock();
      return {
        ok: false,
        reason: 'contract',
        error: `셀록홈즈 검색을 실행하지 못했습니다. ${message}`,
      };
    }

    const AFTER_SEARCH_WAIT_MS = 3_000;
    await page.waitForTimeout(AFTER_SEARCH_WAIT_MS);

    // 익스텐션 미설치 안내 감지 → 명시적 에러
    const extNotice = await checkSelectorOnPage(page, 'sello.extension_missing_notice');
    if (extNotice.ok) {
      await context.close().catch(() => {});
      releaseLock();
      return {
        ok: false,
        reason: 'other',
        error:
          '셀러라이프 확장 프로그램이 활성화되어 있지 않습니다. Chrome 설정에서 확장 활성화 후 재시도.',
      };
    }

    // ── 수집 대기 ───────────────────────────────────────
    const fastMode = options?.fastMode === true;
    const timeoutMs = fastMode ? FAST_TIMEOUT_MS : COLLECTION_TIMEOUT_MS;
    log(`수집 대기 (모드=${fastMode ? 'fast(리뷰만)' : 'full(판매량까지)'}, 최대 ${timeoutMs / 1000}s)...`);
    const deadline = Date.now() + timeoutMs;
    let last = { total: 0, filled: 0 };
    let rows: SelloScrapedRow[] = [];

    while (Date.now() < deadline) {
      if (options?.signal?.aborted) {
        await context.close().catch(() => {});
        releaseLock();
        return { ok: false, reason: 'other', error: '사용자가 중단함' };
      }

      // 폴링과 최종 파싱이 같은 추출 결과를 본다 — 예전에는 서로 다른
      // page.evaluate 를 돌려 원리상 다른 행 집합을 볼 수 있었다.
      rows = await parseRows(page);

      if (fastMode) {
        // fast: review 채워진 행만 카운트. 리뷰는 페이지 렌더 시 즉시 박힘.
        const status = countWithReviews(rows);
        if (status.total !== last.total || status.withReviews !== last.filled) {
          log(`total=${status.total} withReviews=${status.withReviews}`);
          last = { total: status.total, filled: status.withReviews };
        }
        if (status.total >= TARGET_ROWS && status.withReviews >= FAST_MIN_WITH_REVIEWS) {
          log('수집 완료 (fast)');
          break;
        }
      } else {
        // full: 월 조회수까지 채워질 때까지 대기 (확장이 쿠팡 wing API 호출).
        const status = countFilled(rows);
        if (status.total !== last.total || status.filled !== last.filled) {
          log(`total=${status.total} filled=${status.filled}`);
          last = status;
        }
        if (status.total >= TARGET_ROWS && status.filled >= MIN_FILLED) {
          log('수집 완료');
          break;
        }
      }
      await page.waitForTimeout(fastMode ? 1000 : 2000);
    }

    // 대기가 시간 초과로 끝났으면 마지막 폴링 결과는 한 주기(최대 2초)만큼 낡았다.
    // 저장 직전에 한 번 더 읽어 화면과 파일이 어긋나지 않게 한다.
    rows = await parseRows(page);
    last = fastMode
      ? (() => {
          const s = countWithReviews(rows);
          return { total: s.total, filled: s.withReviews };
        })()
      : countFilled(rows);

    // ── 계약 검증 (헌법 P-1) ────────────────────────────
    //
    // 예전에는 대기 시간이 다 되면 그대로 아래로 내려가 0행이어도 ok:true 로
    // 저장했고, 워커는 그걸 '완료'로 기록했다. 사이트 구조가 바뀌어 수집이
    // 완전히 죽어도 화면에는 '데이터 없음'으로만 보였다.
    //
    // 이제 행 셀렉터가 계약을 지키는지 확인한다. 못 지키면 자동 치유를 한 번
    // 시도하고(성공하면 다시 뽑는다), 그래도 안 되면 성공으로 기록하지 않는다.
    const rowCheck = await checkSelectorOnPage(page, 'sello.row');
    if (!rowCheck.ok) {
      log(`⚠ 행 계약 미충족 (${rowCheck.reason}) — 치유를 시도합니다`);
      const healed = await healSelectorOnPage(page, 'sello.row');
      log(`   치유 결과: ${healed.status}/${healed.stage} — ${healed.reason}`);
      if (healed.status === 'healed') {
        rows = await parseRows(page);
        last = fastMode
          ? (() => {
              const s = countWithReviews(rows);
              return { total: s.total, filled: s.withReviews };
            })()
          : countFilled(rows);
      } else {
        await context.close().catch(() => {});
        releaseLock();
        return {
          ok: false,
          reason: 'contract',
          error:
            `셀록홈즈 결과표를 읽지 못했습니다 (${rowCheck.reason}). ` +
            (healed.packageDir
              ? `진단 스냅샷: ${healed.packageDir}. `
              : '') +
            'docs/CRAWL_REGISTRY.md 의 복구 절차를 따르세요.',
        };
      }
    }

    log(`${rows.length}개 행 추출 (${fastMode ? 'withReviews' : 'filled'}=${last.filled})`);

    // ── JSON 저장 ──────────────────────────────────────
    const jsonPath = path.join(outputDir, `${trimmedKw}.json`);
    const json: SelloScrapedJson = {
      keyword: trimmedKw,
      scrapedAt: new Date().toISOString(),
      url: page.url(),
      rowCount: rows.length,
      filledCount: last.filled,
      rows,
    };
    await fs.writeFile(jsonPath, JSON.stringify(json, null, 2), 'utf-8');
    log(`save: ${jsonPath}`);

    await context.close();
    releaseLock();

    return { ok: true, json, jsonPath };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (context) await context.close().catch(() => {});
    releaseLock();
    // 셀렉터 계약 실패는 '알 수 없는 오류'가 아니라 '사이트가 바뀌었다' 는 신호다.
    // 구분해서 돌려줘야 호출부가 재시도 대신 점검을 안내할 수 있다.
    if (e instanceof CrawlContractError) {
      return {
        ok: false,
        reason: 'contract',
        error: `셀록홈즈 화면 구조가 바뀐 것으로 보입니다: ${msg}`,
      };
    }
    return {
      ok: false,
      reason: 'other',
      error: `스크래핑 실패: ${msg}`,
    };
  }
}
