/**
 * HTML 계약 검증 · 셀렉터 역추출 · 표 추출 — 전부 Node 에서 돈다.
 *
 * 출처: market-research-toolkit `registry/contract.py` + `registry/discover_html.py` 이식.
 * ADR: docs/ADR-014.md
 *
 * ── 왜 브라우저 안이 아니라 Node 인가 ────────────────────
 * 이 저장소는 이미 그 함정을 밟고 기록해 뒀다 (`scripts/sello-scraper/scrape.ts:62`):
 * tsx/esbuild 가 함수에 `__name()` 래퍼를 넣는데 브라우저 페이지에는 `__name` 이
 * 없어 ReferenceError 가 난다. 그래서 기존 코드는 파싱 로직을 전부 문자열 안에
 * 인라인으로 적어 두었고, 그 결과 타입 검사도 테스트도 못 받는 상태가 되었다.
 *
 * 여기서는 반대로 간다. 브라우저는 `page.content()` 로 **HTML 문자열만** 내주고,
 * 파싱·검증·역추출은 전부 이 파일에서 한다. 그래서
 *   - `__name` 함정이 구조적으로 사라지고
 *   - 픽스처 HTML 만 있으면 브라우저 없이 단위 테스트가 되고
 *   - 저장된 스냅샷 재검증도 브라우저 없이 된다.
 *
 * ── 원본과의 차이 ────────────────────────────────────────
 * BeautifulSoup 의 `get_text(" ", strip=True)` 는 노드 사이에 공백을 넣는다.
 * cheerio 의 `.text()` 는 그렇지 않아, 공백 정규화만 해서 근사치로 쓴다.
 * `minTextLen` 판정이 원본보다 아주 약간 짧게 나올 수 있으므로 임계값을 촘촘히 잡지 않는다.
 */

import * as cheerio from 'cheerio';

import type { CheckResult, CssContract } from './types';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

/**
 * cheerio 가 다루는 노드 타입.
 *
 * cheerio 는 파싱 결과 노드로 domhandler 의 타입을 그대로 쓰는데 그걸 다시
 * export 하지는 않는다. 그래서 domhandler 를 직접 참조한다 —
 * 추이 의존성에 기대지 않도록 `package.json` 에도 명시해 두었다.
 *
 * `Element` 가 아니라 `AnyNode` 인 이유: `toArray()` 는 문서 노드도 담을 수 있어서
 * 좁은 타입으로 받으면 거짓 안전이 된다. 태그명은 `tagOf()` 가 확인해서 꺼낸다.
 */
type El = AnyNode;

/** 역추출이 내놓을 후보 개수 기본 상한. */
export const DEFAULT_MAX_CANDIDATES = 5;

/**
 * 텍스트에 섞이면 안 되는 태그.
 *
 * cheerio 의 `.text()` 는 `<script>` 안의 자바스크립트 소스까지 문자열로 준다.
 * 브라우저의 `innerText` 는 그러지 않는다. 이 차이를 두면 예컨대
 * "본문에 '익스텐션 설치' 라는 말이 있는가" 같은 계약이, 번들 코드 안에 우연히
 * 그 문자열이 들어 있다는 이유만으로 참이 된다 — 정상 화면을 실패로 만든다.
 *
 * svg·iframe 은 지우지 않는다. 그걸 가리키는 셀렉터가 있을 수 있고,
 * 역추출 단계에서는 어차피 노드 수준으로 걸러낸다.
 */
const TEXT_NOISE_TAGS = 'script, style, noscript, template';

/**
 * 파싱하고 텍스트 노이즈를 걷어낸 문서.
 *
 * 이 파일의 모든 진입점이 이걸 쓴다 — 검증과 추출이 서로 다른 문서를 보면
 * "계약은 통과했는데 값은 안 나온다" 같은 상황이 생긴다.
 */
function loadHtml(html: string): CheerioAPI {
  const $ = cheerio.load(html);
  $(TEXT_NOISE_TAGS).remove();
  return $;
}

// ─────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────

/** 노드 텍스트. bs4 `get_text(" ", strip=True)` 의 근사치. */
function textOf($: CheerioAPI, node: El): string {
  return $(node).text().replace(/\s+/g, ' ').trim();
}

/**
 * 검사 대상 값.
 *
 * `attr` 이 지정됐는데 그 속성이 아예 없으면 null 을 돌려, 빈 문자열
 * ("속성은 있으나 값이 빔") 과 구분한다. 이 구분이 없으면 속성이 사라진 변화를
 * 계약이 못 잡는다.
 */
function valueOf($: CheerioAPI, node: El, attr: string | undefined): string | null {
  if (attr) {
    const raw = $(node).attr(attr);
    return raw === undefined ? null : raw;
  }
  return textOf($, node);
}

function makeQualifier(
  $: CheerioAPI,
  spec: CssContract,
  pattern: RegExp | null,
): (node: El) => boolean {
  return (node: El): boolean => {
    const value = valueOf($, node, spec.attr);
    if (spec.attr && value === null) return false;
    if (pattern !== null && !pattern.test(value ?? '')) return false;
    if (spec.minTextLen !== undefined && textOf($, node).length < spec.minTextLen) return false;
    return true;
  };
}

/** 계약의 정규식을 컴파일한다. 계약 자체가 잘못됐으면 사유를 돌려준다. */
function compilePattern(spec: CssContract): { pattern: RegExp | null; error: string | null } {
  if (!spec.mustMatch) return { pattern: null, error: null };
  try {
    return { pattern: new RegExp(spec.mustMatch), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pattern: null, error: `계약의 정규식을 해석할 수 없습니다: ${msg}` };
  }
}

/**
 * 검사 범위. `rootSelector` 가 있으면 그 컨테이너들, 없으면 문서 전체.
 * 컨테이너가 하나도 안 잡히면 그 사실을 사유로 돌려준다 — 안쪽 셀렉터가
 * 멀쩡한데 컨테이너 때문에 실패한 경우를 구분하기 위해서다.
 */
function resolveRoots(
  $: CheerioAPI,
  rootSelector: string | null | undefined,
): { roots: El[] | null; error: string | null } {
  if (!rootSelector) return { roots: null, error: null };
  let roots: El[];
  try {
    roots = $(rootSelector).toArray();
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    return { roots: null, error: `범위 셀렉터를 해석할 수 없습니다: ${name}` };
  }
  if (roots.length === 0) {
    return { roots: null, error: `범위 셀렉터가 아무것도 잡지 못했습니다: ${rootSelector}` };
  }
  return { roots, error: null };
}

/**
 * 범위 안에서 셀렉터로 노드를 모은다. 셀렉터가 깨졌으면 null.
 *
 * 같은 노드를 두 번 세지 않는다 — 범위 셀렉터가 서로 겹치거나 중첩되면
 * 한 노드가 여러 컨테이너의 자손이 되어 매칭 수가 부풀고, 계약이 거짓으로 통과한다.
 */
function selectWithin($: CheerioAPI, roots: El[] | null, selector: string): El[] | null {
  try {
    if (roots === null) return $(selector).toArray();
    const seen = new Set<El>();
    const out: El[] = [];
    for (const root of roots) {
      for (const node of $(root).find(selector).toArray()) {
        if (seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// 계약 검증
// ─────────────────────────────────────────────────────────

/**
 * CSS 셀렉터가 계약을 만족하는지 본다.
 *
 * 어떤 경우에도 예외를 던지지 않는다 — 잘못된 셀렉터도, 잘못된 계약 정규식도
 * 판정 결과로 돌려준다. 검사 자체가 터지면 "깨진 셀렉터"와 "검사기 버그"를
 * 구분할 수 없기 때문이다.
 */
export function checkCssContract(
  html: string,
  selector: string,
  spec: CssContract,
  rootSelector?: string | null,
): CheckResult {
  const minMatches = spec.minMatches ?? 1;

  if (!selector || !selector.trim()) {
    return { ok: false, matches: 0, reason: '셀렉터가 비어 있습니다' };
  }
  if (!html) {
    return { ok: false, matches: 0, reason: 'HTML 이 비어 있습니다' };
  }

  const { pattern, error: patternError } = compilePattern(spec);
  if (patternError) return { ok: false, matches: 0, reason: patternError };

  const $ = loadHtml(html);

  const { roots, error: rootError } = resolveRoots($, rootSelector);
  if (rootError) return { ok: false, matches: 0, reason: rootError };

  const nodes = selectWithin($, roots, selector);
  if (nodes === null) {
    return { ok: false, matches: 0, reason: `셀렉터를 해석할 수 없습니다: ${selector}` };
  }

  const qualifies = makeQualifier($, spec, pattern);
  const kept = nodes.filter(qualifies).length;

  if (kept >= minMatches) {
    return { ok: true, matches: kept, reason: `${kept}건 매칭 (최소 ${minMatches})` };
  }
  return { ok: false, matches: kept, reason: `${kept}건만 매칭 — 최소 ${minMatches}건 필요` };
}

// ─────────────────────────────────────────────────────────
// 휴리스틱 역추출
// ─────────────────────────────────────────────────────────

/** 사람이 붙인 이름처럼 보이는 토큰만 셀렉터에 쓴다. BEM 구분자 반복 허용 */
const STABLE_TOKEN = /^[a-zA-Z]+([-_]+[a-zA-Z]+)*$/;
/** CSS-in-JS 가 붙이는 접두사 — 뒤는 배포마다 재생성되는 해시다 */
const HASH_PREFIXES = ['sc-', 'css-', 'jsx-', 'emotion-', 'styled-'];
/** 구조가 바뀌어도 잘 남는 시맨틱 속성 */
const SEMANTIC_ATTRS = ['data-testid', 'role', 'itemprop', 'aria-label'];
/** 본문이 아닌 태그. 텍스트 기반 계약에서 정답 집합을 오염시킨다 */
const NOISE_TAGS = new Set([
  'script', 'style', 'svg', 'noscript', 'iframe', 'head', 'meta', 'link', 'template',
]);
/** 토큰이 이보다 짧으면 판단 근거가 부족하다 */
const MIN_TOKEN_LEN = 3;
/** 해시 판정을 시작할 최소 길이 */
const HASH_CHECK_LEN = 4;
/** CamelCase 조각이 전부 이 길이 이하면 사람이 지은 이름이 아니다 */
const MAX_GIBBERISH_WORD = 2;
/** 해시 판정을 하려면 CamelCase 조각이 최소 이만큼 나와야 한다 */
const MIN_WORDS_FOR_HASH = 2;
/** 속성 선택자에 쓸 리터럴의 최소 길이 */
const MIN_LITERAL_LEN = 4;
/** 클래스/부모 후보를 상위 몇 개까지 볼 것인가 */
const TOP_CLASS_CANDIDATES = 3;
/** 과다 매칭 상한을 정할 때 더하는 여유분 */
const CEILING_SLACK = 5;
/** 정답 개수의 몇 배까지를 "과다 매칭 아님"으로 볼 것인가 */
const CEILING_FACTOR = 2;
/** 임계값 계산에 쓰는 분모 (정답 집합의 절반) */
const THRESHOLD_DIVISOR = 2;

function camelWords(segment: string): string[] {
  return segment.match(/[A-Z]+[a-z]*|[a-z]+/g) ?? [];
}

/**
 * 세그먼트가 난수 해시처럼 보이는가.
 * `bdVaJa` 는 조각이 전부 1~2글자라 사람이 지은 이름이 아니다.
 * `MuiButtonBase` 는 Mui/Button/Base 로 충분히 길어 정상으로 본다.
 */
function looksHashed(segment: string): boolean {
  if (segment.length < HASH_CHECK_LEN) return false;
  const words = camelWords(segment);
  if (words.length < MIN_WORDS_FOR_HASH) return false;
  const longest = words.reduce((max, w) => Math.max(max, w.length), 0);
  return longest <= MAX_GIBBERISH_WORD;
}

/** 난수 해시처럼 보이지 않는 클래스/id 인지. */
export function isStableToken(value: string): boolean {
  if (!value || value.length < MIN_TOKEN_LEN) return false;
  if (!STABLE_TOKEN.test(value)) return false;
  const lowered = value.toLowerCase();
  if (HASH_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return false;
  return !value.split(/[-_]+/).some(looksHashed);
}

function stableClasses($: CheerioAPI, node: El): string[] {
  const raw = $(node).attr('class');
  if (!raw) return [];
  return raw.split(/\s+/).filter((c) => c.length > 0 && isStableToken(c));
}

function tagOf(node: El): string {
  const named = node as { tagName?: string; name?: string };
  return (named.tagName ?? named.name ?? '').toLowerCase();
}

/**
 * 정규식에서 속성 선택자에 쓸 리터럴 조각을 뽑는다.
 *
 * 이스케이프된 점은 리터럴 점이다: `coupang\.com` → `coupang.com`.
 * 후보가 여럿이면 가장 긴 것을 쓴다 — 길수록 더 정밀하다.
 */
export function literalFromRegex(source: string | undefined): string | null {
  if (!source) return null;
  let best: string | null = null;
  for (const chunk of source.split(/[|()[\]?*+{}^$]/)) {
    const literal = chunk
      .replace(/\\\./g, '.')
      .replace(/\\-/g, '-')
      .replace(/\\\//g, '/')
      .trim();
    if (literal.includes('\\')) continue; // 남은 이스케이프는 메타문자다
    if (literal.includes('"')) continue; // 따옴표는 속성 선택자를 깨뜨린다
    if (literal.length >= MIN_LITERAL_LEN && (best === null || literal.length > best.length)) {
      best = literal;
    }
  }
  return best;
}

/** Map 을 값 큰 순으로 정렬해 상위 N 개. */
function topEntries(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/**
 * 계약을 통과하는 셀렉터 후보를 좋은 순서로 돌려준다. 못 찾으면 빈 배열.
 *
 * 절차:
 *   1. 계약이 정의한 "정답 노드"를 셀렉터 없이 계약 조건만으로 찾는다
 *   2. 그 노드들에서 **안정적인 토큰만** 골라 후보를 조립한다
 *      (난수 클래스는 버리고 data-testid·role·속성 선택자를 우선한다)
 *   3. 만든 후보를 같은 문서에 다시 적용해 계약으로 검증한다
 *   4. 통과했고 과다 매칭이 아닌 것만, 정답 개수에 가까운 순으로 돌려준다
 *
 * 계약에 제약(`attr` / `mustMatch` / `minTextLen`)이 하나도 없으면 정답을 특정할 수
 * 없으므로 빈 배열을 돌려준다 — 이 경우 치유는 fallback 단계까지만 가능하다.
 */
export function discoverCandidates(
  html: string,
  spec: CssContract,
  options?: { rootSelector?: string | null; maxCandidates?: number },
): string[] {
  if (!html) return [];
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minMatches = spec.minMatches ?? 1;

  const { pattern, error: patternError } = compilePattern(spec);
  if (patternError) return [];

  // 제약이 하나도 없으면 정답을 특정할 수 없다
  if (spec.attr === undefined && pattern === null && spec.minTextLen === undefined) return [];

  const $ = loadHtml(html);
  const { roots, error: rootError } = resolveRoots($, options?.rootSelector);
  if (rootError) return [];

  const qualifies = makeQualifier($, spec, pattern);

  // ── 1) 정답 노드 ──────────────────────────────────────
  const all = selectWithin($, roots, '*');
  if (all === null) return [];

  let answers = all.filter((node) => !NOISE_TAGS.has(tagOf(node)) && qualifies(node));

  if (spec.attr === undefined && answers.length > 0) {
    // 조상은 자식 텍스트를 상속하므로 텍스트 기반 계약을 항상 만족한다.
    // 컨테이너까지 정답으로 잡히면 임계값이 부풀어 정밀한 후보가 탈락한다.
    const candidates = answers;
    answers = candidates.filter(
      (node) => !candidates.some((other) => other !== node && cheerio.contains(node, other)),
    );
  }

  if (answers.length < minMatches) return [];

  // ── 2) 후보 조립 ──────────────────────────────────────
  const tagCounts = new Map<string, number>();
  for (const node of answers) {
    const tag = tagOf(node);
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const commonTag = topEntries(tagCounts, 1)[0]?.[0];
  if (!commonTag) return [];

  // 정답 집합이 커도 소수의 정확한 클래스를 놓치지 않도록 임계값에 상한을 둔다.
  // 절반만 쓰면 정답이 200개일 때 100건 이상인 클래스만 남아 진짜 정답 클래스가 전부 탈락한다.
  const threshold = Math.max(
    1,
    Math.min(Math.floor(answers.length / THRESHOLD_DIVISOR), minMatches),
  );

  const candidates: string[] = [];
  const literal = literalFromRegex(spec.mustMatch);

  // 2-1) 속성 선택자 — 구조 변화에 가장 강하다
  if (spec.attr && literal) {
    candidates.push(`${commonTag}[${spec.attr}*="${literal}"]`);
  }
  for (const sem of SEMANTIC_ATTRS) {
    const values = new Map<string, number>();
    for (const node of answers) {
      const v = $(node).attr(sem);
      if (v) values.set(v, (values.get(v) ?? 0) + 1);
    }
    const best = topEntries(values, 1)[0];
    if (best && best[1] >= threshold) {
      candidates.push(`${commonTag}[${sem}="${best[0]}"]`);
    }
  }

  // 2-2) 안정 클래스
  const classCounts = new Map<string, number>();
  for (const node of answers) {
    for (const cls of stableClasses($, node)) {
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
  }
  for (const [cls, count] of topEntries(classCounts, TOP_CLASS_CANDIDATES)) {
    if (count >= threshold) candidates.push(`${commonTag}.${cls}`);
  }

  // 2-3) 부모의 안정 클래스 + 자식 태그
  const parentCounts = new Map<string, number>();
  for (const node of answers) {
    const parent = $(node).parent().get(0);
    if (!parent) continue;
    const ptag = tagOf(parent);
    if (!ptag || ptag === 'html') continue;
    for (const cls of stableClasses($, parent)) {
      const key = `${ptag}|${cls}`;
      parentCounts.set(key, (parentCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of topEntries(parentCounts, TOP_CLASS_CANDIDATES)) {
    if (count < threshold) continue;
    const sep = key.indexOf('|');
    if (sep <= 0) continue;
    const ptag = key.slice(0, sep);
    const cls = key.slice(sep + 1);
    candidates.push(`${ptag}.${cls} > ${commonTag}`);
    candidates.push(`${ptag}.${cls} ${commonTag}`);
  }

  // 태그만 쓰는 셀렉터는 정밀도가 없다. 다른 후보가 하나도 없을 때만 최후수단
  if (candidates.length === 0) candidates.push(commonTag);

  // ── 3) 검증 + 점수 ────────────────────────────────────
  // 정답보다 크게 많이 잡는 후보는 버린다. 계약에 상한이 없어서
  // 태그 하나짜리 셀렉터가 형식상 "통과"해 버리는 것을 막는 안전장치다.
  const ceiling = Math.max(answers.length * CEILING_FACTOR, answers.length + CEILING_SLACK);

  const seen = new Set<string>();
  const scored: Array<{ score: number; selector: string }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const matched = selectWithin($, roots, candidate);
    if (matched === null) continue;
    const kept = matched.filter(qualifies).length;
    if (kept < minMatches || kept > ceiling) continue;
    // 정답 집합과 매칭 수가 가까울수록 좋다 (과다 매칭은 감점)
    scored.push({ score: Math.abs(kept - answers.length), selector: candidate });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, maxCandidates).map((s) => s.selector);
}

// ─────────────────────────────────────────────────────────
// 표 추출
// ─────────────────────────────────────────────────────────

/** 행 안에서 값 하나를 뽑는 방법. */
export interface RowFieldPlan {
  /** 결과 객체의 키 */
  key: string;
  /**
   * 행 컨테이너 기준 상대 셀렉터들. **앞에서부터 값이 나올 때까지** 시도한다.
   *
   * 추출은 이렇게 너그럽게 하고, "primary 가 아직 맞는가"는 계약 검증이 따로 본다.
   * 그래야 fallback 이 잠깐 받쳐 주는 동안에도 원래 셀렉터가 깨진 사실이 묻히지 않는다.
   */
  selectors: string[];
  /** 값을 속성에서 뽑을 때 그 속성명. null 이면 텍스트를 쓴다 */
  attr: string | null;
}

/** `extractRows` 인자. */
export interface ExtractRowsArgs {
  rowSelector: string;
  /** 행 컨테이너 자체에서 읽을 속성들 */
  rowAttrs: string[];
  fields: RowFieldPlan[];
  /** 존재 여부만 볼 항목들. 셀렉터 하나라도 잡히면 true */
  flags: Array<{ key: string; selectors: string[] }>;
}

/** 행 하나의 추출 결과. */
export interface ExtractedRow {
  attrs: Record<string, string | null>;
  fields: Record<string, string | null>;
  flags: Record<string, boolean>;
}

/**
 * 표의 행들을 레지스트리가 준 계획대로 뽑는다.
 *
 * 셀렉터를 전부 인자로 받는다 — 이 함수 안에 사이트별 셀렉터가 하나도 없어야
 * 사이트가 바뀌었을 때 고칠 곳이 `selectors.json` 한 군데로 모인다.
 *
 * 값이 없으면 `null` 을 넣는다. 빈 문자열과 구분해야 "칸이 아직 안 채워졌다"와
 * "칸은 있는데 값이 비었다"를 나눠 판단할 수 있다.
 */
export function extractRows(html: string, args: ExtractRowsArgs): ExtractedRow[] {
  if (!html) return [];
  const $ = loadHtml(html);

  let rows: El[];
  try {
    rows = $(args.rowSelector).toArray();
  } catch {
    return [];
  }

  return rows.map((row): ExtractedRow => {
    const attrs: Record<string, string | null> = {};
    for (const name of args.rowAttrs) {
      attrs[name] = $(row).attr(name) ?? null;
    }

    const fields: Record<string, string | null> = {};
    for (const plan of args.fields) {
      let value: string | null = null;
      for (const selector of plan.selectors) {
        let el: El | undefined;
        try {
          el = $(row).find(selector).get(0);
        } catch {
          continue; // 깨진 셀렉터는 건너뛴다. 계약 검증이 따로 잡아낸다
        }
        if (!el) continue;
        if (plan.attr) {
          const raw = $(el).attr(plan.attr);
          if (raw !== undefined && raw.length > 0) {
            value = raw;
            break;
          }
        } else {
          const text = textOf($, el);
          if (text.length > 0) {
            value = text;
            break;
          }
        }
      }
      fields[plan.key] = value;
    }

    const flags: Record<string, boolean> = {};
    for (const flag of args.flags) {
      let present = false;
      for (const selector of flag.selectors) {
        try {
          if ($(row).find(selector).length > 0) {
            present = true;
            break;
          }
        } catch {
          continue;
        }
      }
      flags[flag.key] = present;
    }

    return { attrs, fields, flags };
  });
}

/**
 * 계약을 만족하는 첫 요소가 문서에서 몇 번째인지.
 *
 * 텍스트로 고르는 버튼(`'선택'` 등)을 Playwright 로 클릭할 때, 어떤 인덱스를
 * 눌러야 하는지 알려 준다. 없으면 -1.
 */
export function indexOfFirstMatch(
  html: string,
  selector: string,
  spec: CssContract,
): number {
  if (!html) return -1;
  const { pattern, error } = compilePattern(spec);
  if (error) return -1;

  const $ = loadHtml(html);
  let nodes: El[];
  try {
    nodes = $(selector).toArray();
  } catch {
    return -1;
  }
  const qualifies = makeQualifier($, spec, pattern);
  return nodes.findIndex(qualifies);
}
