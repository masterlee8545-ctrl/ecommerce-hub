/**
 * 4단계 치유 파이프라인 — 브라우저 없이, HTML 문자열만으로 돈다.
 *
 * 출처: market-research-toolkit `registry/heal.py` 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 명시 에러)
 *
 *   1) primary        — 지금 값이 계약을 지키면 그대로 종료
 *   2) fallbacks      — 등록된 후보를 순서대로 시도, 통과하면 승격
 *   3) 휴리스틱 역추출 — 계약이 정의한 정답 노드에서 안정 토큰만 골라 셀렉터 재조립
 *   4) 스냅샷 내보내기 — 전부 실패하면 첨부용 패키지만 만들고 레지스트리는 손대지 않는다
 *
 * **어느 단계에서 나온 후보든 계약 검증을 통과해야만 승격된다.**
 * 이 규칙이 깨지면 레지스트리가 오염되고, 그 뒤로는 무엇을 믿을지 알 수 없게 된다.
 *
 * ── 원본과 다른 점: 언제 점검하는가 ─────────────────────
 * 원본 툴킷은 대표 URL 을 무인으로 열어 점검한다. 셀록홈즈는 로그인 세션 +
 * 브라우저 확장 + 검색 실행이 있어야 표가 그려지므로 그 방식이 통하지 않는다.
 * 그래서 여기서는 **실제 수집 도중 찍은 화면 HTML** 로 검증하고 치유한다.
 * 검증할 데이터가 화면에 실제로 있는 순간이라 오히려 판정이 정확하다.
 *
 * 대신 샘플이 한 장뿐이라 과적합을 걸러 낼 수 없다. 그래서 휴리스틱으로 채택한
 * 셀렉터는 이력에 `singleSample: true` 로 남겨, 나중에 사람이 의심할 근거를 남긴다.
 */

import { checkCssContract, discoverCandidates, extractRows } from './dom';
import { exportPackage, pruneSnapshots } from './export-package';
import { getEntry, promote, selectorIdsByPrefix } from './registry';

import type { ExtractedRow, ExtractRowsArgs, RowFieldPlan } from './dom';
import type { CheckResult, CssContract, HealResult, SelectorEntry } from './types';

/** 셀렉터가 계약을 못 지켰을 때 던지는 에러. 조용한 빈 결과를 막는다 (P-1). */
export class CrawlContractError extends Error {
  public readonly selectorId: string;
  public readonly selector: string;
  public readonly matches: number;
  public readonly contractReason: string;

  constructor(selectorId: string, selector: string, reason: string, matches: number) {
    super(
      `[crawl] 셀렉터 계약 실패 — ${selectorId}\n` +
        `  현재 셀렉터: ${selector}\n` +
        `  사유: ${reason}\n` +
        '  사이트 구조가 바뀌었을 가능성이 큽니다. data/crawl-snapshots/ 의 스냅샷을 확인하세요.',
    );
    this.name = 'CrawlContractError';
    this.selectorId = selectorId;
    this.selector = selector;
    this.matches = matches;
    this.contractReason = reason;
  }
}

// ─────────────────────────────────────────────────────────
// 범위 · 계약 해석
// ─────────────────────────────────────────────────────────

/** `within` 이 가리키는 컨테이너의 현재 셀렉터. 문서 전체 기준이면 null. */
async function resolveRootSelector(entry: SelectorEntry): Promise<string | null> {
  if (!entry.within) return null;
  const container = await getEntry(entry.within);
  return container.primary;
}

/** css 셀렉터의 계약. json 항목에 부르면 던진다 — 호출부 착오를 조용히 넘기지 않는다. */
export function asCssContract(entry: SelectorEntry): CssContract {
  if (entry.kind !== 'css') {
    throw new Error(`[crawl] css 셀렉터가 아닙니다 (kind=${entry.kind}). JSON 계약은 호출 시점에 검증됩니다.`);
  }
  return entry.contract as CssContract;
}

// ─────────────────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────────────────

/** 셀렉터 하나가 이 HTML 에서 계약을 지키는지 본다. 치유는 하지 않는다. */
export async function checkSelector(
  html: string,
  selectorId: string,
  overrideSelector?: string,
): Promise<CheckResult> {
  const entry = await getEntry(selectorId);
  const spec = asCssContract(entry);
  const rootSelector = await resolveRootSelector(entry);
  return checkCssContract(html, overrideSelector ?? entry.primary, spec, rootSelector);
}

/**
 * 계약을 지키는지 확인하고, 아니면 던진다.
 *
 * 수집 경로에서 "0건인데 성공"이 만들어지지 않게 하는 관문이다.
 *
 * @returns 계약을 만족한 노드 수
 */
export async function assertSelector(html: string, selectorId: string): Promise<number> {
  const entry = await getEntry(selectorId);
  const result = await checkSelector(html, selectorId);
  if (!result.ok) {
    throw new CrawlContractError(selectorId, entry.primary, result.reason, result.matches);
  }
  return result.matches;
}

// ─────────────────────────────────────────────────────────
// 치유
// ─────────────────────────────────────────────────────────

/**
 * 셀렉터 하나를 점검하고, 깨졌으면 4단계로 복구를 시도한다.
 *
 * @param options.auto false 면 1단계만 하고 판정만 돌려준다 (승격하지 않음)
 */
export async function healSelector(
  html: string,
  selectorId: string,
  options?: { auto?: boolean; now?: string },
): Promise<HealResult> {
  const auto = options?.auto ?? true;
  const entry = await getEntry(selectorId);

  if (entry.kind !== 'css') {
    return {
      selectorId,
      status: 'skipped',
      stage: 'none',
      selector: entry.primary,
      matches: 0,
      reason: 'JSON 계약은 HTML 점검 대상이 아닙니다 (API 호출 시점에 검증됩니다)',
      packageDir: null,
    };
  }

  const spec = asCssContract(entry);
  const rootSelector = await resolveRootSelector(entry);

  // ── 1) primary ────────────────────────────────────────
  const primaryResult = checkCssContract(html, entry.primary, spec, rootSelector);
  if (primaryResult.ok) {
    return {
      selectorId,
      status: 'ok',
      stage: 'primary',
      selector: entry.primary,
      matches: primaryResult.matches,
      reason: primaryResult.reason,
      packageDir: null,
    };
  }

  if (!auto) {
    return {
      selectorId,
      status: 'failed',
      stage: 'none',
      selector: entry.primary,
      matches: primaryResult.matches,
      reason: primaryResult.reason,
      packageDir: null,
    };
  }

  // ── 2) fallbacks ──────────────────────────────────────
  for (const candidate of entry.fallbacks) {
    const result = checkCssContract(html, candidate, spec, rootSelector);
    if (!result.ok) continue;
    await promote(selectorId, candidate, {
      stage: 'fallback',
      singleSample: true,
      reason: result.reason,
      ...(options?.now ? { now: options.now } : {}),
    });
    return {
      selectorId,
      status: 'healed',
      stage: 'fallback',
      selector: candidate,
      matches: result.matches,
      reason: `fallback 승격 — ${result.reason}`,
      packageDir: null,
    };
  }

  // ── 3) 휴리스틱 역추출 ────────────────────────────────
  const candidates = discoverCandidates(html, spec, { rootSelector });
  for (const candidate of candidates) {
    const result = checkCssContract(html, candidate, spec, rootSelector);
    if (!result.ok) continue;
    await promote(selectorId, candidate, {
      stage: 'heuristic',
      singleSample: true,
      reason: result.reason,
      ...(options?.now ? { now: options.now } : {}),
    });
    return {
      selectorId,
      status: 'healed',
      stage: 'heuristic',
      selector: candidate,
      matches: result.matches,
      reason: `휴리스틱 복구 — ${result.reason} (샘플 1건이라 과적합 가능)`,
      packageDir: null,
    };
  }

  // ── 4) 스냅샷 내보내기 ────────────────────────────────
  const packageDir = await exportPackage(selectorId, entry, html, primaryResult.reason);
  await pruneSnapshots(selectorId);

  return {
    selectorId,
    status: 'failed',
    stage: 'none',
    selector: entry.primary,
    matches: primaryResult.matches,
    reason: packageDir
      ? `${primaryResult.reason} — 스냅샷을 내보냈습니다: ${packageDir}`
      : `${primaryResult.reason} — 스냅샷 저장에도 실패했습니다`,
    packageDir,
  };
}

/**
 * 접두사로 묶인 셀렉터들을 한 화면에서 전부 점검한다.
 *
 * 컨테이너(`within` 이 null 인 것)를 먼저 처리한다 — 컨테이너가 깨진 채로
 * 그 안쪽 셀렉터를 검사하면 전부 "범위가 비었다"로 몰려 원인이 가려진다.
 */
export async function healGroup(
  html: string,
  prefix: string,
  options?: { auto?: boolean; onResult?: (result: HealResult) => void },
): Promise<HealResult[]> {
  const ids = await selectorIdsByPrefix(prefix);
  const entries = await Promise.all(ids.map(async (id) => ({ id, entry: await getEntry(id) })));
  const ordered = [
    ...entries.filter((e) => e.entry.kind === 'css' && e.entry.within === null),
    ...entries.filter((e) => e.entry.kind === 'css' && e.entry.within !== null),
  ];

  const results: HealResult[] = [];
  for (const { id } of ordered) {
    let result: HealResult;
    try {
      const opts = options?.auto === undefined ? undefined : { auto: options.auto };
      result = await healSelector(html, id, opts);
    } catch (err) {
      result = {
        selectorId: id,
        status: 'failed',
        stage: 'none',
        selector: '',
        matches: 0,
        reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        packageDir: null,
      };
    }
    results.push(result);
    options?.onResult?.(result);
  }
  return results;
}

/**
 * 사람이 받아 온 후보들을 **저장된 스냅샷으로 재검증**한 뒤 통과한 것만 채택한다.
 *
 * 자동 복구가 실패해 `data/crawl-snapshots/…/PROMPT.md` 를 Claude 에 첨부하고
 * 답을 받아 왔을 때 쓰는 경로다. 답을 그대로 믿지 않는다 — 틀린 셀렉터를 받아도
 * 계약 검증에서 떨어지므로 레지스트리는 오염되지 않는다.
 *
 * @returns 채택한 셀렉터. 전부 계약을 못 지키면 null
 */
export async function adoptCandidates(
  snapshotHtml: string,
  selectorId: string,
  candidates: string[],
): Promise<{ adopted: string; matches: number } | null> {
  const entry = await getEntry(selectorId);
  const spec = asCssContract(entry);
  const rootSelector = await resolveRootSelector(entry);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const result = checkCssContract(snapshotHtml, trimmed, spec, rootSelector);
    if (!result.ok) continue;
    await promote(selectorId, trimmed, {
      stage: 'manual',
      singleSample: true,
      reason: `스냅샷 재검증 통과 — ${result.reason}`,
    });
    return { adopted: trimmed, matches: result.matches };
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 표 추출 (레지스트리 연동)
// ─────────────────────────────────────────────────────────

/** 행 추출 계획. 값은 레지스트리 셀렉터 id 로 적는다 — 셀렉터 문자열이 코드에 없다. */
export interface RowExtractionPlan {
  /** 행 컨테이너 셀렉터의 id */
  rowSelectorId: string;
  /** 행 컨테이너에서 직접 읽을 속성들 */
  rowAttrs: string[];
  /** 결과 키 → { 셀렉터 id, 값을 읽을 속성 } */
  fields: Record<string, { selectorId: string; attr?: string | null }>;
  /** 결과 키 → 존재 여부만 볼 셀렉터 id */
  flags: Record<string, string>;
}

/** 계획의 셀렉터 id 를 현재 셀렉터 문자열로 바꾼다. */
export async function resolveRowPlan(plan: RowExtractionPlan): Promise<ExtractRowsArgs> {
  const rowEntry = await getEntry(plan.rowSelectorId);

  const fields: RowFieldPlan[] = [];
  for (const [key, spec] of Object.entries(plan.fields)) {
    const entry = await getEntry(spec.selectorId);
    fields.push({
      key,
      selectors: [entry.primary, ...entry.fallbacks],
      attr: spec.attr ?? null,
    });
  }

  const flags: Array<{ key: string; selectors: string[] }> = [];
  for (const [key, selectorId] of Object.entries(plan.flags)) {
    const entry = await getEntry(selectorId);
    flags.push({ key, selectors: [entry.primary, ...entry.fallbacks] });
  }

  return { rowSelector: rowEntry.primary, rowAttrs: plan.rowAttrs, fields, flags };
}

/**
 * 레지스트리의 현재 셀렉터로 표를 읽는다.
 *
 * 셀렉터 문자열이 호출부에 하나도 없다는 점이 핵심이다 — 사이트가 바뀌면
 * `selectors.json` 만 고치면 되고, 치유가 성공하면 코드 수정 없이 이어진다.
 */
export async function extractRowsWithRegistry(
  html: string,
  plan: RowExtractionPlan,
): Promise<ExtractedRow[]> {
  return extractRows(html, await resolveRowPlan(plan));
}
