/**
 * Playwright 어댑터 — 열려 있는 페이지와 레지스트리를 잇는 얇은 층.
 *
 * ADR: docs/ADR-014.md
 *
 * 이 파일이 하는 일은 딱 둘이다:
 *   - 페이지에서 HTML 문자열을 꺼내 `heal.ts` 에 넘긴다
 *   - 레지스트리가 정한 요소를 실제로 누르거나 입력한다
 *
 * 파싱·검증·역추출은 전부 `dom.ts` / `heal.ts` 에서 Node 로 돈다.
 * 브라우저 안에서 함수를 돌리지 않는 이유는 `dom.ts` 상단 주석을 참고.
 *
 * playwright 는 **타입으로만** 가져온다. 브라우저를 띄우는 책임은 호출부에 있다.
 */

import { indexOfFirstMatch } from './dom';
import {
  asCssContract,
  checkSelector,
  CrawlContractError,
  extractRowsWithRegistry,
  healGroup,
  healSelector,
} from './heal';
import { getEntry } from './registry';

import type { ExtractedRow } from './dom';
import type { RowExtractionPlan } from './heal';
import type { CheckResult, HealResult } from './types';
import type { Locator, Page } from 'playwright';

/** 계약 충족을 기다릴 때 화면을 다시 읽는 간격 */
const DEFAULT_POLL_MS = 1_000;

// ─────────────────────────────────────────────────────────
// 검증 · 치유
// ─────────────────────────────────────────────────────────

/** 지금 화면에서 셀렉터가 계약을 지키는지 본다. */
export async function checkSelectorOnPage(page: Page, selectorId: string): Promise<CheckResult> {
  return checkSelector(await page.content(), selectorId);
}

/** 계약을 지키는지 확인하고, 아니면 던진다. */
export async function assertSelectorOnPage(page: Page, selectorId: string): Promise<number> {
  const entry = await getEntry(selectorId);
  const result = await checkSelectorOnPage(page, selectorId);
  if (!result.ok) {
    throw new CrawlContractError(selectorId, entry.primary, result.reason, result.matches);
  }
  return result.matches;
}

/** 지금 화면으로 4단계 치유를 시도한다. */
export async function healSelectorOnPage(
  page: Page,
  selectorId: string,
  options?: { auto?: boolean },
): Promise<HealResult> {
  const opts = options?.auto === undefined ? undefined : { auto: options.auto };
  return healSelector(await page.content(), selectorId, opts);
}

/** 접두사로 묶인 셀렉터들을 지금 화면으로 한꺼번에 점검한다. */
export async function healGroupOnPage(
  page: Page,
  prefix: string,
  options?: { auto?: boolean; onResult?: (result: HealResult) => void },
): Promise<HealResult[]> {
  return healGroup(await page.content(), prefix, options);
}

/**
 * 계약이 충족될 때까지 기다린다. 시간이 다 되면 치유를 한 번 시도하고,
 * 그래도 안 되면 던진다.
 *
 * `page.waitForSelector` 를 그대로 쓰지 않는 이유: 그건 "요소가 있는가"만 본다.
 * 요소는 있는데 값이 안 채워진 상태를 성공으로 읽어 버리면 0건 수집이 성공으로
 * 기록된다. 계약은 "쓸 수 있는 상태인가"까지 본다.
 */
export async function waitForContract(
  page: Page,
  selectorId: string,
  options: { timeoutMs: number; pollMs?: number; autoHeal?: boolean; onProgress?: (msg: string) => void },
): Promise<number> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const autoHeal = options.autoHeal ?? true;
  const deadline = Date.now() + options.timeoutMs;
  const entry = await getEntry(selectorId);

  let last: CheckResult = { ok: false, matches: 0, reason: '아직 확인하지 않았습니다' };
  let html = '';

  while (Date.now() < deadline) {
    html = await page.content();
    last = await checkSelector(html, selectorId);
    if (last.ok) return last.matches;
    await page.waitForTimeout(pollMs);
  }

  if (!autoHeal) {
    throw new CrawlContractError(selectorId, entry.primary, last.reason, last.matches);
  }

  options.onProgress?.(`[crawl] ${selectorId} 계약 미충족 — 치유를 시도합니다 (${last.reason})`);
  const healed = await healSelector(html || (await page.content()), selectorId);
  if (healed.status === 'healed') {
    options.onProgress?.(`[crawl] ${selectorId} 복구됨 (${healed.stage}): ${healed.selector}`);
    return healed.matches;
  }

  throw new CrawlContractError(selectorId, entry.primary, healed.reason, healed.matches);
}

// ─────────────────────────────────────────────────────────
// 조작
// ─────────────────────────────────────────────────────────

/** 클릭 방식. 원래 코드가 쓰던 방식을 항목별로 보존하기 위한 선택지다. */
export interface ClickOptions {
  /**
   * true 면 요소에 click 이벤트를 직접 보낸다 (원래 코드의 in-page `element.click()` 과 같다).
   *
   * Playwright 의 기본 클릭은 보이는지·움직이지 않는지·가려지지 않았는지를 먼저 기다린다.
   * 드롭다운 항목처럼 애니메이션 중이거나 겹쳐 있는 요소에서는 그 대기가 새로운
   * 실패 원인이 된다 — 원래는 없던 실패다. 그런 자리에는 이 옵션을 켠다.
   */
  programmatic?: boolean | undefined;
}

/**
 * 계약을 만족하는 첫 요소를 클릭한다.
 *
 * 텍스트로 고르는 버튼(`'선택'`, `'1 페이지 상품분석'`)도 계약의 `mustMatch` 로
 * 표현되므로, 화면 문구가 바뀌면 코드가 아니라 `selectors.json` 만 고치면 된다.
 *
 * 원래 코드는 이런 클릭의 성공 여부를 확인하지 않아, 버튼을 못 찾아도 조용히
 * 넘어간 뒤 엉뚱한 결과를 수집했다. 여기서는 못 누르면 false 를 돌려준다.
 *
 * 텍스트 계약은 Playwright 의 **라이브 DOM 필터**로 고른다. 스냅샷으로 순번을 세어
 * `nth()` 로 누르면, 그 사이 DOM 이 바뀌었을 때 엉뚱한 요소를 누르게 된다.
 *
 * @returns 클릭했으면 true. 계약을 만족하는 요소가 없으면 false
 */
export async function clickByContract(
  page: Page,
  selectorId: string,
  options?: ClickOptions,
): Promise<boolean> {
  const entry = await getEntry(selectorId);
  const spec = asCssContract(entry);

  let target: Locator;
  if (spec.attr === undefined && spec.mustMatch !== undefined) {
    // 텍스트 계약 — 라이브 DOM 에서 바로 거른다
    target = page.locator(entry.primary).filter({ hasText: new RegExp(spec.mustMatch) });
  } else {
    // 속성 계약 등은 라이브 필터로 표현할 수 없어 스냅샷 순번을 쓴다.
    // nth(-1) 은 Playwright 에서 '마지막 요소' 를 뜻하므로 반드시 먼저 걸러야 한다.
    const index = indexOfFirstMatch(await page.content(), entry.primary, spec);
    if (index < 0) return false;
    target = page.locator(entry.primary).nth(index);
  }

  if ((await target.count()) === 0) return false;

  if (options?.programmatic === true) {
    await target.first().dispatchEvent('click');
  } else {
    await target.first().click();
  }
  return true;
}

/** 계약을 만족하는 첫 요소를 클릭하고, 못 누르면 던진다. */
export async function clickByContractOrThrow(
  page: Page,
  selectorId: string,
  options?: ClickOptions,
): Promise<void> {
  const clicked = await clickByContract(page, selectorId, options);
  if (!clicked) {
    const entry = await getEntry(selectorId);
    const result = await checkSelector(await page.content(), selectorId);
    throw new CrawlContractError(selectorId, entry.primary, result.reason, result.matches);
  }
}

/** 레지스트리가 가리키는 입력칸에 값을 채운다. */
export async function fillByRegistry(
  page: Page,
  selectorId: string,
  value: string,
): Promise<void> {
  const entry = await getEntry(selectorId);
  await page.fill(entry.primary, value);
}

// ─────────────────────────────────────────────────────────
// 추출
// ─────────────────────────────────────────────────────────

/** 지금 화면의 표를 레지스트리 계획대로 읽는다. */
export async function extractRowsFromPage(
  page: Page,
  plan: RowExtractionPlan,
): Promise<ExtractedRow[]> {
  return extractRowsWithRegistry(await page.content(), plan);
}

export { CrawlContractError };
export type { ExtractedRow, RowExtractionPlan };
