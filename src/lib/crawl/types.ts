/**
 * 크롤링 커널 공용 타입.
 *
 * 출처: market-research-toolkit 의 `registry/` + `sources/base.py` 설계를 TypeScript 로 이식.
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 명시 에러),
 *       §1 P-3 (신뢰도 마킹), §1 P-7 (시크릿 노출 금지)
 * ADR: docs/ADR-014.md
 *
 * 왜 이 계층이 필요한가:
 * - 셀렉터가 코드 곳곳에 문자열로 박혀 있으면 사이트가 바뀌었을 때
 *   "어디가 왜 깨졌는지" 알 방법이 없다. 계약(contract)은 그 판정 근거다.
 * - 계약이 있어야 자동 치유가 성립한다. 후보 셀렉터를 채택해도 되는지
 *   판단할 기준이 없으면 아무 후보나 승격되어 레지스트리가 오염된다.
 */

// ─────────────────────────────────────────────────────────
// 계약 (contract)
// ─────────────────────────────────────────────────────────

/**
 * CSS 셀렉터가 "맞다"고 판정하는 조건.
 *
 * 최소 하나의 제약(attr / mustMatch / minTextLen)이 있어야 휴리스틱 역추출이
 * 정답 노드를 특정할 수 있다. minMatches 만 있는 계약도 유효하지만,
 * 그런 계약은 자동 역추출 단계에서 후보를 만들지 못하고 fallback 까지만 시도된다.
 */
export interface CssContract {
  /** 계약을 만족해야 하는 최소 노드 수 (기본 1) */
  minMatches?: number | undefined;
  /** 검사 대상 속성. 지정하면 그 속성이 없는 노드는 계약 불만족으로 본다 */
  attr?: string | undefined;
  /** 검사 대상 값이 만족해야 하는 정규식 (JS RegExp 문법 문자열) */
  mustMatch?: string | undefined;
  /** 노드 텍스트의 최소 길이 */
  minTextLen?: number | undefined;
}

/** JSON API 응답이 "맞다"고 판정하는 조건. */
export interface JsonContract {
  /** 기대 HTTP 상태 (기본 200) */
  status?: number | undefined;
  /** `data.items` 같은 점 표기 경로. 전부 존재해야 통과 */
  jsonKeys?: string[] | undefined;
}

/** 계약 검증 결과. 통과 여부와 그 근거를 함께 돌려준다. */
export interface CheckResult {
  ok: boolean;
  /** 계약을 만족한 노드 수 (JSON 계약은 통과 시 1) */
  matches: number;
  /** 사람이 읽을 판정 근거. 실패 시 원인이 여기 담긴다 */
  reason: string;
}

// ─────────────────────────────────────────────────────────
// 레지스트리 항목
// ─────────────────────────────────────────────────────────

/** 셀렉터 종류. `css` 는 DOM 셀렉터, `json` 은 API 응답 계약. */
export type SelectorKind = 'css' | 'json';

/**
 * 치유가 일어난 단계.
 *
 * `revert` 는 되돌리기가 남긴 기록이다. 이걸 따로 두지 않으면 되돌리기를 두 번 눌렀을 때
 * **자기 자신의 되돌리기 기록을 치유로 오인해 다시 되살려 버린다.**
 */
export type HealStage = 'primary' | 'fallback' | 'heuristic' | 'manual' | 'revert' | 'none';

/** 점검/치유 한 건의 판정. */
export type HealStatus = 'ok' | 'healed' | 'failed' | 'skipped';

/**
 * 레지스트리에 기록되는 셀렉터 한 건.
 *
 * `id` 는 `<소스>.<역할>` 규칙을 쓴다 (예: `sello.row`, `itemscout.category_data`).
 */
export interface SelectorEntry {
  kind: SelectorKind;
  /** 현재 사용 중인 셀렉터 (css) 또는 응답 경로 설명 (json) */
  primary: string;
  /** primary 가 깨졌을 때 순서대로 시도할 후보 */
  fallbacks: string[];
  /** 이 셀렉터가 맞는지 판정하는 조건 */
  contract: CssContract | JsonContract;
  /**
   * 이 셀렉터가 다른 셀렉터가 잡은 컨테이너 **안쪽** 기준일 때 그 컨테이너의 id.
   *
   * 예: `sello.row_price` 는 `sello.row` 가 잡은 행 하나 안에서 `li.price` 를 찾는다.
   * 계약 검증과 역추출도 그 컨테이너들의 자손으로 범위가 좁혀진다.
   * 문서 전체 기준이면 null.
   */
  within: string | null;
  /** 사람이 읽을 설명 — 무엇을 가리키는 셀렉터인가 */
  description: string;
  /**
   * 점검용 대표 URL. css 계약은 이 페이지를 열어 검증한다.
   * 비어 있으면 자동 점검에서 제외된다.
   */
  sampleUrls: string[];
  /**
   * 로그인 세션이나 브라우저 확장이 있어야 열리는 페이지인가.
   * true 면 무인 점검에서 건너뛴다 (열 수 없는 페이지를 실패로 기록하지 않기 위해).
   */
  requiresBrowser: boolean;
  /** 마지막 치유 시각 (ISO 8601). 치유된 적 없으면 null */
  healedAt: string | null;
  /** 치유 직전에 쓰던 셀렉터. 되돌리기의 근거 */
  healedFrom: string | null;
}

/** `selectors.json` 파일 전체 구조. */
export interface SelectorRegistryFile {
  version: number;
  selectors: Record<string, SelectorEntry>;
}

/** 되돌리기가 정확히 복원할 수 있도록, 바꾸기 **직전** 항목의 모습을 통째로 남긴다. */
export interface EntrySnapshot {
  primary: string;
  fallbacks: string[];
  healedAt: string | null;
  healedFrom: string | null;
}

/** `history.jsonl` 한 줄. 모든 레지스트리 변경이 여기 남는다. */
export interface HistoryRecord {
  at: string;
  selectorId: string;
  stage: HealStage;
  from: string;
  to: string;
  /** 샘플이 1건뿐이라 과적합 위험이 있는 채택이었는가 */
  singleSample: boolean;
  reason: string;
  /**
   * 바꾸기 직전의 항목 상태.
   *
   * `from` 하나만으로 되돌리면 fallbacks 목록과 치유 표시가 유실된다
   * (승격 때 fallbacks 를 재배열하기 때문). 통째로 남겨 두고 통째로 복원한다.
   * 이 필드가 없는 옛 기록은 `from` 만으로 근사 복원한다.
   */
  previous?: EntrySnapshot | undefined;
}

/** 점검/치유 한 건의 결과. */
export interface HealResult {
  selectorId: string;
  status: HealStatus;
  stage: HealStage;
  selector: string;
  matches: number;
  reason: string;
  /** 자동 복구 실패 시 내보낸 스냅샷 패키지 폴더 (없으면 null) */
  packageDir: string | null;
}

// ─────────────────────────────────────────────────────────
// 수집 리포트
// ─────────────────────────────────────────────────────────

/**
 * 소스 한 곳의 수집 결과 상태.
 *
 * - `ok`      정상 수집, 1건 이상
 * - `empty`   호출은 성공했으나 0건 — **성공이 아니다.** 계약이 깨졌거나 진짜로 없거나
 * - `error`   호출 자체가 실패
 * - `skipped` 자격증명 없음 등의 이유로 시도하지 않음
 */
export type SourceStatus = 'ok' | 'empty' | 'error' | 'skipped';

/** 소스 한 곳의 수집 결과. */
export interface SourceOutcome {
  status: SourceStatus;
  count: number;
  /** 실패 사유. status 가 ok 면 null */
  error: string | null;
  /** 걸린 시간 (밀리초) */
  elapsedMs: number;
  /** 이 소스가 의존한 셀렉터 ID 들 — 깨졌을 때 어디를 고칠지 가리킨다 */
  selectorIds: string[];
}

/**
 * 여러 소스를 묶은 수집 리포트.
 *
 * 한 소스가 실패해도 전체가 실패하지 않는다. 대신 실패가 `sources` 에
 * 그대로 드러나고 `gaps` 에 사람이 읽을 설명이 쌓인다 (P-1: 은폐 금지).
 */
export interface CrawlReport<T> {
  /** 무엇을 수집했는가 (키워드/카테고리 등) */
  subject: string;
  generatedAt: string;
  summary: {
    totalItems: number;
    bySource: Record<string, number>;
    okSources: number;
    failedSources: number;
  };
  sources: Record<string, SourceOutcome>;
  items: T[];
  /**
   * 빈칸 목록. "어느 소스가 왜 비었는지" 를 사람 말로 적는다.
   * UI 는 이걸 그대로 ❓ 로 보여주면 된다 (P-3).
   */
  gaps: string[];
}
