#!/usr/bin/env node
/**
 * 크롤링 커널 연기 점검 (ADR-014) — 진짜 브라우저로 어댑터 경로 전체를 한 번 태운다.
 *
 *   npm run crawl:smoke
 *
 * ── 이게 확인해 주는 것 ──────────────────────────────────
 *   page.content() → cheerio 파싱 → 계약 검증 → locator 클릭 → 표 추출 → 4단계 자동치유
 *
 * 단위 테스트(`npm test`)는 HTML 문자열만 다루므로 Playwright 어댑터 경로를 못 건드린다.
 * 특히 `page.evaluate` 안에서 함수가 `__name` 래퍼에 걸리는 함정
 * (`scripts/sello-scraper/scrape.ts:62`)은 진짜 브라우저를 띄워야만 드러난다.
 *
 * ── 확인해 주지 **못하는** 것 ────────────────────────────
 * 셀록홈즈의 **실제 DOM** 이 우리 셀렉터와 맞는지. 여기 쓰는 화면은 구조만 흉내 낸
 * 가짜다. 실제 검증은 로그인 세션 + 셀러라이프 확장이 있는 PC 에서
 * `npm run sello:scrape -- <키워드>` 로만 가능하다.
 *
 * ── 안전 ─────────────────────────────────────────────────
 * 치유는 레지스트리 덮개 파일을 쓴다. 그게 저장소에 남으면 실제 수집이 가짜 셀렉터로
 * 돌아간다. 그래서 시작하자마자 임시 폴더로 cwd 를 옮긴다 (덮개 경로가 cwd 기준이다).
 * 네트워크에는 전혀 나가지 않는다 — `page.setContent` 로 만든 화면만 쓴다.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import {
  checkSelectorOnPage,
  clickByContractOrThrow,
  extractRowsFromPage,
  fillByRegistry,
  healSelectorOnPage,
  waitForContract,
  type RowExtractionPlan,
} from '../src/lib/crawl/page.js';
import { getEntry, resetRegistryCache } from '../src/lib/crawl/registry.js';

const PLAN: RowExtractionPlan = {
  rowSelectorId: 'sello.row',
  rowAttrs: ['data-rank', 'data-coupangid', 'data-itemid'],
  fields: {
    name: { selectorId: 'sello.row_name' },
    price: { selectorId: 'sello.row_price' },
    review: { selectorId: 'sello.row_review' },
    productUrl: { selectorId: 'sello.row_link', attr: 'href' },
  },
  flags: { isRocketDelivery: 'sello.row_rocket' },
};

/** 셀록홈즈 결과표의 구조만 흉내 낸 페이지. 실제 값은 전부 가짜다. */
function buildPage(opts: { hashedClasses: boolean }): string {
  const rowClass = opts.hashedClasses ? 'sc-bdVaJa xKlMnO' : 'td';
  const rows = [1, 2, 3]
    .map(
      (rank) => `
    <ul class="${rowClass}" data-rank="${rank}" data-coupangid="c${rank}" data-itemid="i${rank}">
      <li class="name">
        <div class="prd-img"><img src="https://img.example.test/${rank}.jpg" alt=""></div>
        <div class="goods-name"><a href="https://www.coupang.com/vp/products/${rank}">테스트 상품 ${rank}</a></div>
      </li>
      <li class="price">12,${rank}00원</li>
      <li class="review"><span class="num">${rank * 7}</span></li>
      <li class="pv-month"><span class="num">-</span></li>
      ${rank === 1 ? '<li class="del rocket">로켓배송</li>' : ''}
    </ul>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">
  <script>var noise = "익스텐션 설치가 필요합니다";</script>
  </head><body>
    <input class="search-input" type="text" />
    <button>선택</button>
    <button>취소</button>
    <button class="search-icon">검색</button>
    <ul class="dropdown"><li>1 페이지 상품분석</li><li>2 페이지 상품분석</li></ul>
    <div class="list">${rows}</div>
  </body></html>`;
}

function ok(label: string, detail = ''): void {
  process.stdout.write(`  ✅ ${label}${detail ? ` — ${detail}` : ''}\n`);
}

async function main(): Promise<void> {
  // 치유가 저장소의 레지스트리 덮개를 건드리지 않도록 임시 폴더로 옮긴다.
  // 이걸 빼먹으면 이 점검이 실제 수집용 셀렉터를 가짜 값으로 바꿔 놓는다.
  const sandbox = await mkdtemp(path.join(tmpdir(), 'crawl-smoke-'));
  process.chdir(sandbox);
  process.stdout.write(`샌드박스: ${sandbox}\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let failures = 0;
  const fail = (label: string, detail: string): void => {
    failures += 1;
    process.stdout.write(`  ❌ ${label} — ${detail}\n`);
  };

  try {
    // ── 1) 정상 화면 ──────────────────────────────────
    process.stdout.write('\n[1] 정상 화면\n');
    await page.setContent(buildPage({ hashedClasses: false }));

    const matched = await waitForContract(page, 'sello.search_input', { timeoutMs: 5_000 });
    ok('검색칸 계약 충족', `${matched}건`);

    await fillByRegistry(page, 'sello.search_input', '양말');
    const filled = await page.inputValue('input.search-input');
    if (filled === '양말') ok('레지스트리로 입력', `"${filled}"`);
    else fail('레지스트리로 입력', `기대 "양말", 실제 "${filled}"`);

    // 텍스트 계약으로 정확히 '선택' 버튼만 골라 누르는지
    await page.evaluate(`window.__clicks = [];
      document.querySelectorAll('button, li').forEach(function (el) {
        el.addEventListener('click', function () { window.__clicks.push(el.textContent.trim()); });
      });`);
    await clickByContractOrThrow(page, 'sello.page_select_trigger', { programmatic: true });
    await clickByContractOrThrow(page, 'sello.page_select_option', { programmatic: true });
    await clickByContractOrThrow(page, 'sello.search_button');
    const clicks = (await page.evaluate('window.__clicks')) as string[];
    const expected = ['선택', '1 페이지 상품분석', '검색'];
    if (JSON.stringify(clicks) === JSON.stringify(expected)) {
      ok('계약으로 클릭', clicks.join(' → '));
    } else {
      fail('계약으로 클릭', `기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(clicks)}`);
    }

    // 확장 미설치 안내는 <script> 안에만 있으므로 걸리면 안 된다
    const notice = await checkSelectorOnPage(page, 'sello.extension_missing_notice');
    if (!notice.ok) ok('script 안 문자열을 안내로 오탐하지 않음');
    else fail('확장 안내 오탐', notice.reason);

    const rowCheck = await checkSelectorOnPage(page, 'sello.row');
    if (rowCheck.ok) ok('행 계약 충족', rowCheck.reason);
    else fail('행 계약', rowCheck.reason);

    const rows = await extractRowsFromPage(page, PLAN);
    const first = rows[0];
    const rowsOk =
      rows.length === 3 &&
      first?.attrs['data-rank'] === '1' &&
      first?.fields['name'] === '테스트 상품 1' &&
      first?.fields['price'] === '12,100원' &&
      first?.fields['review'] === '7' &&
      first?.fields['productUrl'] === 'https://www.coupang.com/vp/products/1' &&
      first?.flags['isRocketDelivery'] === true &&
      rows[1]?.flags['isRocketDelivery'] === false;
    if (rowsOk) ok('표 추출', `${rows.length}행, 1행=${first?.fields['name']} / ${first?.fields['price']}`);
    else fail('표 추출', JSON.stringify(rows[0]));

    // ── 2) 사이트가 클래스를 난수로 바꾼 화면 ──────────
    process.stdout.write('\n[2] 클래스가 난수로 바뀐 화면 (자동치유)\n');
    await page.setContent(buildPage({ hashedClasses: true }));

    const broken = await checkSelectorOnPage(page, 'sello.row');
    if (!broken.ok) ok('깨진 것을 감지', broken.reason);
    else fail('깨짐 감지 실패', '계약이 그대로 통과해 버렸다');

    const healed = await healSelectorOnPage(page, 'sello.row');
    if (healed.status === 'healed') {
      ok('자동 복구', `${healed.stage} → ${healed.selector} (${healed.matches}건)`);
    } else {
      fail('자동 복구', `${healed.status}/${healed.stage} — ${healed.reason}`);
    }

    resetRegistryCache();
    const after = await getEntry('sello.row');
    const recheck = await checkSelectorOnPage(page, 'sello.row');
    if (recheck.ok) ok('복구 후 재검증', `primary=${after.primary}, healedFrom=${after.healedFrom}`);
    else fail('복구 후 재검증', recheck.reason);

    const healedRows = await extractRowsFromPage(page, PLAN);
    if (healedRows.length === 3 && healedRows[0]?.fields['name'] === '테스트 상품 1') {
      ok('복구된 셀렉터로 추출', `${healedRows.length}행`);
    } else {
      fail('복구된 셀렉터로 추출', `${healedRows.length}행`);
    }

    // ── 3) fallback 도 전부 빗나간 화면 (휴리스틱 역추출) ──
    // 컨테이너 태그가 ul → div 로 바뀌고 data-coupangid 도 사라졌다.
    // 등록된 fallback 이 하나도 안 맞으므로 3단계가 실제로 돌아야 한다.
    process.stdout.write('\n[3] fallback 도 안 맞는 화면 (휴리스틱 역추출)\n');
    const divRows = [1, 2, 3]
      .map(
        (rank) => `
      <div class="css-1a2b3c" data-rank="${rank}">
        <li class="name"><div class="goods-name"><a href="https://www.coupang.com/vp/products/${rank}">테스트 상품 ${rank}</a></div></li>
        <li class="price">9,${rank}00원</li>
        <li class="review"><span class="num">${rank}</span></li>
      </div>`,
      )
      .join('');
    await page.setContent(
      `<!doctype html><html><body><div class="list">${divRows}</div></body></html>`,
    );

    const brokenAgain = await checkSelectorOnPage(page, 'sello.row');
    if (!brokenAgain.ok) ok('다시 깨진 것을 감지', brokenAgain.reason);
    else fail('깨짐 감지 실패', '계약이 그대로 통과해 버렸다');

    const healed2 = await healSelectorOnPage(page, 'sello.row');
    if (healed2.status === 'healed' && healed2.stage === 'heuristic') {
      ok('휴리스틱 역추출로 복구', `${healed2.selector} (${healed2.matches}건)`);
    } else if (healed2.status === 'healed') {
      ok(`복구(${healed2.stage} 단계)`, healed2.selector);
    } else {
      fail('휴리스틱 복구', `${healed2.status} — ${healed2.reason}`);
    }

    resetRegistryCache();
    const recheck2 = await checkSelectorOnPage(page, 'sello.row');
    if (recheck2.ok) ok('복구 후 재검증', recheck2.reason);
    else fail('복구 후 재검증', recheck2.reason);

    const rows3 = await extractRowsFromPage(page, PLAN);
    if (rows3.length === 3 && rows3[0]?.fields['price'] === '9,100원') {
      ok('복구된 셀렉터로 추출', `${rows3.length}행, 1행 가격=${rows3[0]?.fields['price']}`);
    } else {
      fail('복구된 셀렉터로 추출', JSON.stringify(rows3[0]?.fields));
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(
    failures === 0 ? '\n통합 점검 통과\n' : `\n실패 ${failures}건\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
