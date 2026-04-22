#!/usr/bin/env node
/**
 * 셀록홈즈 쿠팡 키워드 DOM 스크래퍼
 *
 * BUYWISE(buywise-marketing-tool) 의 scrape.ts 를 그대로 이식.
 * 단, 이커머스허브는 별도 setup 단계를 두지 않고 BUYWISE 가 이미
 * 준비한 `C:\sello-user-data` 프로필을 공유해서 재사용한다.
 *
 * 전제:
 *   - 실행 전 모든 Chrome 창이 종료된 상태여야 함 (프로필 락 충돌 방지)
 *   - BUYWISE 가 동시에 sello:scrape 돌리는 중이 아닐 것
 *   - 사용자 Chrome 에 sellochomes.co.kr 로그인 + 셀러라이프 확장 이미 있음
 *
 * 사용법:  npm run sello:scrape -- 바디오일
 * 출력:    data/sello-scrape/{keyword}.json, {keyword}.png
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { ROOT, loadExtensionConfig } from './lib.js';

const OUTPUT_DIR = path.join(ROOT, 'data', 'sello-scrape');
const DEFAULT_USER_DATA = 'C:\\sello-user-data';
const USER_DATA_DIR = process.env['SELLO_USER_DATA_DIR'] ?? DEFAULT_USER_DATA;
const PROFILE_DIR = process.env['SELLO_PROFILE_DIR'] ?? 'Default';
const PAGE_URL =
  'https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword';
const COLLECTION_TIMEOUT_MS = 180_000;
const TARGET_ROWS = 20;
const MIN_FILLED = 18;

const KEYWORD = process.argv[2] ?? '바디오일';

interface ScrapedRow {
  rank: string | null;
  coupangId: string | null;
  itemId: string | null;
  sourcingMonthlyAmount: string | null;
  name: string | null;
  price: string | null;
  review: string | null;
  pvMonth: string | null;
  sales: string | null;
  salesMonth: string | null;
  cvMonth: string | null;
  sourcingPrice: string | null;
  expectedAmount: string | null;
  expectedPriceRate: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  isRocketDelivery: boolean;
}

interface CollectStatus {
  total: number;
  filled: number;
}

// page.evaluate 내부에서 named 화살표 함수/const 사용하면 tsx/esbuild가 __name() 래퍼 삽입 → browser에 __name 없음 → ReferenceError
// 해결: 모든 로직 인라인화 (helper 없음)
async function parseRows(page: Page): Promise<ScrapedRow[]> {
  return page.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll("ul.td[data-rank]"));
    return rows.map(function (row) {
      function t(sel) {
        const el = row.querySelector(sel);
        return el ? (el.textContent || "").trim() : null;
      }
      function attr(sel, name) {
        const el = row.querySelector(sel);
        return el ? el.getAttribute(name) : null;
      }
      return {
        rank: row.getAttribute("data-rank"),
        coupangId: row.getAttribute("data-coupangid"),
        itemId: row.getAttribute("data-itemid"),
        sourcingMonthlyAmount: row.getAttribute("data-sourcing-monthly-amount"),
        name: t("li.name .goods-name") || t("li.name"),
        price: t("li.price"),
        review: t("li.review .num"),
        pvMonth: t("li.pv-month .num"),
        sales: t("li.sales .num"),
        salesMonth: t("li.sales-month .num"),
        cvMonth: t("li.cv-month .num"),
        sourcingPrice: t("li.sourcing-price"),
        expectedAmount: t("li.expected-amount"),
        expectedPriceRate: t("li.expected-price-rate"),
        imageUrl: attr("li.name .prd-img img", "src"),
        productUrl: attr("li.name .goods-name a", "href"),
        isRocketDelivery: !!row.querySelector("li.del.rocket"),
      };
    });
  })()`);
}

async function countFilled(page: Page): Promise<CollectStatus> {
  return page.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll("ul.td[data-rank]"));
    let filled = 0;
    for (let i = 0; i < rows.length; i++) {
      const num = rows[i].querySelector("li.pv-month .num");
      const raw = num ? (num.textContent || "").trim() : "";
      if (raw && /\\d/.test(raw) && raw !== "-" && raw !== "0") filled += 1;
    }
    return { total: rows.length, filled: filled };
  })()`);
}

async function debugSnapshot(page: Page, label: string): Promise<void> {
  const shot = path.join(OUTPUT_DIR, `_debug-${label}-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const bodyText = await page
    .evaluate(
      `document.body ? document.body.innerText.slice(0, 2000) : ""`,
    )
    .catch(() => '');
  console.log(`[debug:${label}] 스크린샷=${shot}`);
  console.log(
    `[debug:${label}] bodyText=${String(bodyText).slice(0, 500).replace(/\s+/g, ' ')}`,
  );

  const probe = await page
    .evaluate(
      `(() => {
    function visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function textOf(el) { return el ? (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 300) : ''; }

    const modalSelectors = [
      '[role="dialog"]',
      '.modal', '.popup', '.dialog', '.overlay',
      '[class*="Modal"]', '[class*="modal"]',
      '[class*="Popup"]', '[class*="popup"]',
      '[class*="Dialog"]', '[class*="dialog"]',
      '[class*="overlay"]', '[class*="Overlay"]',
    ];
    const modals = [];
    for (const sel of modalSelectors) {
      const els = document.querySelectorAll(sel);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!visible(el)) continue;
        modals.push({
          selector: sel,
          tag: el.tagName,
          classes: (el.className || '').toString().slice(0, 200),
          text: textOf(el).slice(0, 200),
        });
      }
    }

    const rowSelectors = [
      'ul.td[data-rank]',
      'ul[data-rank]',
      '[data-rank]',
      '[data-coupangid]',
      '[data-itemid]',
      'ul.td',
      'table tbody tr',
      '.product-item',
      '.product-row',
      '[class*="product"]',
      '[class*="rank-row"]',
      '[class*="rankRow"]',
      '.rank-list li',
      '.list-table .row',
    ];
    const rowCounts = {};
    for (const sel of rowSelectors) {
      try { rowCounts[sel] = document.querySelectorAll(sel).length; } catch (e) { rowCounts[sel] = 'ERR'; }
    }

    const dataElements = [];
    const allWithData = document.querySelectorAll('[data-rank], [data-coupangid], [data-itemid]');
    for (let i = 0; i < Math.min(3, allWithData.length); i++) {
      const el = allWithData[i];
      dataElements.push({
        tag: el.tagName,
        classes: (el.className || '').toString().slice(0, 200),
        attrs: Array.from(el.attributes).map(a => a.name + '=' + a.value.slice(0, 50)).join(' '),
      });
    }

    const zIndexCandidates = [];
    const allEls = document.querySelectorAll('body *');
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      const s = getComputedStyle(el);
      const z = parseInt(s.zIndex, 10);
      if (!isNaN(z) && z >= 100 && visible(el)) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 100) {
          zIndexCandidates.push({
            tag: el.tagName,
            classes: (el.className || '').toString().slice(0, 150),
            zIndex: z,
            pos: s.position,
            text: textOf(el).slice(0, 150),
            rect: Math.round(r.width) + 'x' + Math.round(r.height),
          });
        }
      }
    }
    zIndexCandidates.sort((a, b) => b.zIndex - a.zIndex);

    return {
      htmlLen: document.documentElement.outerHTML.length,
      bodyLen: document.body ? document.body.innerHTML.length : 0,
      modals: modals.slice(0, 10),
      rowCounts: rowCounts,
      dataElements: dataElements,
      topZ: zIndexCandidates.slice(0, 8),
    };
  })()`,
    )
    .catch((e: unknown) => ({ error: String(e) }));

  console.log(`[debug:${label}] probe=${JSON.stringify(probe, null, 2)}`);
}

async function run(): Promise<void> {
  console.log(`[scrape] keyword="${KEYWORD}"`);
  console.log(`[scrape] userDataDir="${USER_DATA_DIR}" profile="${PROFILE_DIR}"`);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const { extensionPath } = await loadExtensionConfig();
  console.log(`[scrape] extensionPath="${extensionPath}"`);

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: null,
      ignoreDefaultArgs: [
        '--enable-automation',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
      args: [
        `--profile-directory=${PROFILE_DIR}`,
        `--load-extension=${extensionPath}`,
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-first-run',
        '--restore-last-session=false',
        '--disable-session-crashed-bubble',
        '--start-maximized',
      ],
    });
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: function () { return undefined; } });
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array; } catch (e) {}
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise; } catch (e) {}
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol; } catch (e) {}
    `);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Chrome launch 실패: ${msg}\n\n` +
        `해결:\n` +
        `  1) Chrome 창/프로세스 완전히 종료 후 재시도 (taskkill //F //IM chrome.exe)\n` +
        `  2) BUYWISE 가 동시에 sello:scrape 돌리고 있지 않은지 확인 (프로필 락 충돌)\n` +
        `  3) USER_DATA_DIR 경로 확인: ${USER_DATA_DIR}`,
    );
  }

  console.log(`[chrome] pages=${context.pages().length}`);
  const workers = context.serviceWorkers();
  console.log(`[chrome] service workers=${workers.length}`);
  for (const w of workers) console.log(`  - ${w.url()}`);

  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.bringToFront();

  console.log(`[nav] ${PAGE_URL}`);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  let currentUrl = page.url();
  if (currentUrl.includes('/auth/login') || currentUrl.includes('/signin')) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[로그인 필요] sellochomes 로그인 페이지로 리다이렉트됨`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  1. 열린 Chrome에서 로그인 완료`);
    console.log(`  2. 로그인 후 keyword-analysis 페이지로 자동 이동 대기`);
    console.log(`  3. 완료 시그널: touch ${path.join(ROOT, '.sello-logged-in')}`);
    console.log(`${'='.repeat(60)}\n`);

    const signalFile = path.join(ROOT, '.sello-logged-in');
    await fs.unlink(signalFile).catch(() => {});

    const loginDeadline = Date.now() + 300_000;
    while (Date.now() < loginDeadline) {
      try {
        await fs.access(signalFile);
        console.log(`[login] 시그널 파일 감지 → 진행`);
        await fs.unlink(signalFile).catch(() => {});
        break;
      } catch {
        await page.waitForTimeout(1000);
      }
    }

    await page.goto(PAGE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    currentUrl = page.url();
    if (currentUrl.includes('/auth/login') || currentUrl.includes('/signin')) {
      throw new Error(`로그인 대기 후에도 여전히 로그인 페이지: ${currentUrl}`);
    }
  }
  console.log(`[nav] OK: ${currentUrl}`);

  await page.waitForTimeout(2000);
  const extInfo = (await page.evaluate(`({
    id: document.documentElement.getAttribute('extension-id'),
    version: document.documentElement.getAttribute('extension-version'),
  })`)) as { id: string | null; version: string | null };
  console.log(`[ext] id=${extInfo.id} version=${extInfo.version}`);

  const navLinks = (await page.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links
      .map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50) }))
      .filter(l => l.text && l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('#'))
      .slice(0, 80);
  })()`)) as Array<{ href: string; text: string }>;
  console.log(`[nav-links] count=${navLinks.length}`);
  for (const l of navLinks) {
    if (
      l.text.includes('쿠팡') ||
      l.text.includes('시장') ||
      l.text.includes('순위') ||
      l.text.includes('분석')
    ) {
      console.log(`  [관련] ${l.text} → ${l.href}`);
    }
  }

  const modalClosed = await page.evaluate(`(() => {
    const btn = document.querySelector('.close-modal.modal-header-close-button');
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
  if (modalClosed) console.log(`[modal] 캡챠 권장 모달 닫음`);

  const uiProbe = await page.evaluate(`(() => {
    function visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .map(b => ({ text: (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), classes: (b.className || '').toString().slice(0, 120) }))
      .slice(0, 60);
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter(visible)
      .map(i => ({ type: i.type, name: i.name, classes: (i.className || '').toString().slice(0, 120), placeholder: i.placeholder }))
      .slice(0, 30);
    const selects = Array.from(document.querySelectorAll('select'))
      .filter(visible)
      .map(s => ({ classes: (s.className || '').toString().slice(0, 120), options: Array.from(s.options).map(o => o.text).slice(0, 10) }))
      .slice(0, 10);
    const pageBtns = Array.from(document.querySelectorAll('[class*="page"], [class*="Page"]'))
      .filter(visible)
      .map(el => ({ tag: el.tagName, classes: (el.className || '').toString().slice(0, 120), text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) }))
      .slice(0, 30);
    return { buttons, inputs, selects, pageBtns };
  })()`);
  console.log(`[ui-probe] ${JSON.stringify(uiProbe, null, 2)}`);

  await page.waitForSelector('input.search-input', { timeout: 15_000 });
  await page.fill('input.search-input', KEYWORD);

  const pagePicked = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    for (const b of btns) {
      if ((b.textContent || '').trim() === '선택') { b.click(); return 'opened'; }
    }
    return 'no-button';
  })()`);
  console.log(`[page-select] 드롭다운 상태=${pagePicked}`);
  await page.waitForTimeout(1000);

  const pageOption = await page.evaluate(`(() => {
    const lis = Array.from(document.querySelectorAll('li'));
    for (const li of lis) {
      const t = (li.textContent || '').trim();
      if (t === '1 페이지 상품분석') { li.click(); return 'clicked'; }
    }
    return 'not-found';
  })()`);
  console.log(`[page-select] "1 페이지 상품분석" 클릭=${pageOption}`);
  await page.waitForTimeout(500);

  await page.click('button.search-icon');
  console.log(`[input] "${KEYWORD}" 검색 트리거 (1페이지)`);

  await page.waitForTimeout(3000);
  const hasExtensionModal = await page.evaluate(() => {
    const body = document.body.innerText;
    return body.includes('익스텐션 설치') || body.includes('확장 프로그램 설치');
  });
  if (hasExtensionModal) {
    const shot = path.join(OUTPUT_DIR, `_ext-missing-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    throw new Error(
      `익스텐션 설치 모달 감지됨 — 셀러라이프 확장 활성화 확인. 스크린샷: ${shot}`,
    );
  }

  await debugSnapshot(page, 'after-search');

  console.log(
    `[wait] 수집 완료 대기 (최대 ${COLLECTION_TIMEOUT_MS / 1000}s)...`,
  );
  const deadline = Date.now() + COLLECTION_TIMEOUT_MS;
  let last: CollectStatus = { total: 0, filled: 0 };

  while (Date.now() < deadline) {
    const status = (await countFilled(page)) as CollectStatus;
    if (status.total !== last.total || status.filled !== last.filled) {
      console.log(`[wait] total=${status.total} filled=${status.filled}`);
      last = status;
    }
    if (status.total >= TARGET_ROWS && status.filled >= MIN_FILLED) {
      console.log(`[wait] 완료`);
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (last.filled < MIN_FILLED) {
    console.warn(
      `[wait] 타임아웃 — total=${last.total} filled=${last.filled}. 부분 결과로 진행.`,
    );
    await debugSnapshot(page, 'timeout');
  }

  const rows = (await parseRows(page)) as ScrapedRow[];
  console.log(`[parse] ${rows.length}개 행 추출`);

  const rowSample = await page
    .evaluate(
      `(() => {
    const r = document.querySelector('ul.td[data-rank]');
    if (!r) return null;
    const imgs = Array.from(r.querySelectorAll('img')).map(function (i) {
      return { src: i.getAttribute('src'), alt: i.getAttribute('alt') || '', classes: (i.className || '').toString().slice(0, 120) };
    });
    const badges = Array.from(r.querySelectorAll('[class*="rocket"], [class*="Rocket"], [class*="badge"], [class*="Badge"], [class*="ad"], [class*="Ad"]'))
      .map(function (el) { return { tag: el.tagName, classes: (el.className || '').toString().slice(0, 160), text: (el.textContent || '').trim().slice(0, 60) }; });
    return {
      outerHTML: r.outerHTML.slice(0, 6000),
      liList: Array.from(r.querySelectorAll(':scope > li')).map(function (li) {
        return { classes: (li.className || '').toString().slice(0, 120), text: (li.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) };
      }),
      imgs: imgs,
      badges: badges,
    };
  })()`,
    )
    .catch(() => null);
  if (rowSample) {
    const samplePath = path.join(OUTPUT_DIR, `_row-sample-${KEYWORD}.json`);
    await fs.writeFile(samplePath, JSON.stringify(rowSample, null, 2), 'utf-8');
    console.log(`[diag] 행 샘플 저장: ${samplePath}`);
  }

  const shotPath = path.join(OUTPUT_DIR, `${KEYWORD}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });

  const jsonPath = path.join(OUTPUT_DIR, `${KEYWORD}.json`);
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        keyword: KEYWORD,
        scrapedAt: new Date().toISOString(),
        url: page.url(),
        rowCount: rows.length,
        filledCount: last.filled,
        rows,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`[save] ${jsonPath}`);
  console.log(`[save] ${shotPath}`);

  await context.close();
  console.log(`\n[done] rows=${rows.length} filled=${last.filled}`);
}

run().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[error] ${msg}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
