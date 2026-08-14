/**
 * 수집 전용 fetch — 금고 · 헤더 · 재시도 · 응답 계약을 한 경로로 모은다.
 *
 * 출처: market-research-toolkit `sources/base.py` 의 fetch 설계 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-7 (시크릿 노출 금지)
 *
 * ── 왜 하나로 모으는가 ───────────────────────────────────
 * 같은 사이트를 부르는 fetch 블록이 다섯 군데에 흩어져 있었고, 그때마다
 * Cookie · User-Agent · Referer · AbortController 타임아웃을 따로 적고 있었다
 * (`sellochomes/client.ts` 의 252·502·539·714·868 줄). User-Agent 는 Chrome 147 과
 * 149 로 서로 달랐다. 어느 하나만 고치면 나머지는 그대로 남는 구조였다.
 *
 * ── 봇 탐지 회피에 대해 정직하게 ─────────────────────────
 * 원본 툴킷은 `curl_cffi` 로 **TLS 핑거프린트(JA3)** 까지 크롬으로 위장한다.
 * Node 에는 그에 직접 대응하는 순수 JS 수단이 없다 — undici 의 TLS 스택은
 * Node 것이고, 바꾸려면 네이티브 바인딩이 필요하다. 그래서 여기서 하는 일은
 * **HTTP 계층의 신호를 일관되게 맞추는 것까지**다:
 *   - 브라우저와 같은 헤더 조합 (`sec-ch-ua`, `sec-fetch-*`, `Accept-Language`)
 *   - 호스트별로 맞는 Referer/Origin
 *   - 재시도 간격에 지터를 넣어 기계적인 주기를 없앰
 * TLS 지문을 보는 방어에는 이걸로 부족하다. 그런 벽을 만나면 브라우저 경로
 * (`run-scrape.ts`) 를 써야 한다. 이 한계를 코드가 감추지 않도록 여기 적어 둔다.
 */

import { checkJsonContract } from './contract';
import { CrawlError } from './errors';
import { getEntry } from './registry';

import type { JsonContract } from './types';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
/** 첫 재시도까지 기다리는 시간 */
const BACKOFF_BASE_MS = 500;
/** 재시도마다 대기 시간을 몇 배로 늘릴 것인가 */
const BACKOFF_FACTOR = 2;
/** 아무리 밀려도 이 이상은 기다리지 않는다 */
const BACKOFF_MAX_MS = 8_000;
/** 대기 시간에 섞을 흔들림 비율 (±25%) — 기계적인 주기를 없앤다 */
const BACKOFF_JITTER = 0.25;
/** `Retry-After` 를 존중하되 이 이상은 기다리지 않는다 */
const RETRY_AFTER_CAP_MS = 30_000;
/** 서버 오류로 보고 재시도할 상태의 하한 */
const SERVER_ERROR_MIN = 500;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

/** 크롬 버전은 한 곳에서만 정한다 — 예전엔 파일 안에서 147/149 가 섞여 있었다 */
const CHROME_MAJOR = '149';
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// ─────────────────────────────────────────────────────────
// 헤더 프로필
// ─────────────────────────────────────────────────────────

/**
 * 사이트별 요청 성격.
 *
 * `origin` / `referer` 를 프로필에 묶어 두는 이유: 이 값들이 어긋나면 내부 API 가
 * 요청을 거부한다. 호출부마다 손으로 적으면 반드시 어긋난다.
 */
export interface HeaderProfile {
  origin: string | null;
  /** 브라우저 흉내를 낼 때 보낼 Referer. `browserLike: false` 면 무시된다 */
  referer: string;
  /** JSON 본문을 보낼 것인가 */
  json: boolean;
  /** XHR 로 보이게 할 것인가 */
  xhr: boolean;
  /**
   * 브라우저처럼 보이게 할 것인가 (기본 true).
   *
   * 공식 API(네이버 검색, 카카오 로컬)는 키로 인증하므로 위장이 필요 없다.
   * 그런 곳에 크롬 헤더를 붙이면 얻는 것 없이 요청만 지저분해진다.
   */
  browserLike?: boolean | undefined;
  /**
   * `Sec-Fetch-Site` 값 (기본 `same-origin`).
   *
   * 다른 서브도메인으로 가는 요청(예: itemscout.io → api.itemscout.io)에
   * `same-origin` 을 실으면 실제 브라우저가 보내는 값과 어긋난다.
   * 위장을 하려면 조합이 앞뒤가 맞아야 한다.
   */
  secFetchSite?: 'same-origin' | 'same-site' | 'cross-site' | 'none' | undefined;
}

/** 브라우저가 실제로 보내는 조합에 맞춘 공통 헤더. */
function baseHeaders(profile: HeaderProfile): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  };

  if (profile.browserLike !== false) {
    headers['User-Agent'] = USER_AGENT;
    headers['sec-ch-ua'] =
      `"Chromium";v="${CHROME_MAJOR}", "Not:A-Brand";v="24", "Google Chrome";v="${CHROME_MAJOR}"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = profile.secFetchSite ?? 'same-origin';
    headers['Referer'] = profile.referer;
    if (profile.origin) headers['Origin'] = profile.origin;
    if (profile.xhr) headers['x-requested-with'] = 'XMLHttpRequest';
  }

  if (profile.json) headers['Content-Type'] = 'application/json';
  return headers;
}

// ─────────────────────────────────────────────────────────
// 재시도
// ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 지터를 섞은 지수 백오프. */
function backoffDelay(attempt: number): number {
  const raw = Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt, BACKOFF_MAX_MS);
  const jitter = raw * BACKOFF_JITTER * (Math.random() * BACKOFF_FACTOR - 1);
  return Math.max(0, Math.round(raw + jitter));
}

/** `Retry-After` 헤더를 밀리초로. 없거나 이상하면 null. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - Date.now()), RETRY_AFTER_CAP_MS);
}

/**
 * 다시 시도해도 되는 상태인가.
 *
 * 401/403 은 재시도하지 않는다 — 만료된 자격증명으로 계속 두드리면
 * 시간만 버리고 계정이 잠길 수 있다. 사용자가 갱신해야 풀리는 문제다.
 */
function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= SERVER_ERROR_MIN;
}

// ─────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────

export interface CrawlFetchOptions {
  /** 어느 수집원인가. 에러 메시지와 리포트에 쓰인다 */
  source: string;
  /** 사람이 알아볼 엔드포인트 라벨. **URL 전문을 넣지 않는다** (P-7) */
  endpoint: string;
  profile: HeaderProfile;
  method?: 'GET' | 'POST';
  /** `connect.sid=...; _ga=...` 형태의 완성된 쿠키 헤더 */
  cookie?: string | undefined;
  body?: string | undefined;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  retries?: number | undefined;
  /**
   * 응답을 검증할 레지스트리 항목 id (`kind: 'json'`).
   * 주면 응답 모양이 계약과 다를 때 `schema_mismatch` 로 던진다.
   */
  contractId?: string | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((attempt: number, delayMs: number, reason: string) => void) | undefined;
}

/**
 * JSON 응답을 받아 온다. 실패는 전부 `CrawlError` 로 던진다 — 빈 값을 돌려주지 않는다.
 *
 * @throws CrawlError 자격증명 만료 / 한도 초과 / 스키마 불일치 / 네트워크 / 타임아웃
 */
export async function crawlFetchJson<T>(url: string, options: CrawlFetchOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const detail = { source: options.source, endpoint: options.endpoint };

  const headers: Record<string, string> = {
    ...baseHeaders(options.profile),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.headers ?? {}),
  };

  let lastError: CrawlError | null = null;
  /** 서버가 `Retry-After` 로 지시한 대기. 있으면 백오프 대신 이걸 쓴다 */
  let forcedDelayMs: number | null = null;

  /**
   * 호출자가 중단했는가.
   *
   * 함수로 감싸는 이유: `signal.aborted` 는 밖에서 바뀌는 값인데, 직접 비교하면
   * TypeScript 가 첫 검사 이후로 계속 false 라고 좁혀 버린다.
   */
  const isAborted = (): boolean => options.signal?.aborted ?? false;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // 호출자가 이미 중단시켰으면 요청을 보내지 않는다.
    // 예전에는 여기서 걸러지지 않아, 중단한 뒤에도 남은 재시도가 그대로 나갔다.
    if (isAborted()) {
      throw new CrawlError('network', { ...detail, reason: '호출자가 중단했습니다' });
    }

    if (attempt > 0) {
      const delay = forcedDelayMs ?? backoffDelay(attempt - 1);
      forcedDelayMs = null;
      options.onRetry?.(attempt, delay, lastError?.code ?? 'unknown');
      await sleep(delay);
      if (isAborted()) {
        throw new CrawlError('network', { ...detail, reason: '호출자가 중단했습니다' });
      }
    }

    const controller = new AbortController();
    // 타이머는 **본문 읽기가 끝날 때까지** 살려 둔다. 헤더만 받고 타이머를 끄면
    // 본문이 안 오는 응답에서 무기한 매달린다 (선언한 제한시간이 무의미해진다).
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onOuterAbort);

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
    };

    /** fetch/본문 읽기에서 난 예외를 사유 있는 CrawlError 로 옮긴다. */
    const toTransportError = (err: unknown): CrawlError => {
      const outerAborted = isAborted();
      const timedOut = !outerAborted && err instanceof Error && err.name === 'AbortError';
      return new CrawlError(
        timedOut ? 'timeout' : 'network',
        { ...detail, reason: err instanceof Error ? err.message : String(err) },
        err,
      );
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      cleanup();
      lastError = toTransportError(err);
      if (isAborted()) throw lastError; // 호출자가 중단 — 재시도하지 않는다
      if (attempt === maxRetries) throw lastError;
      continue;
    }

    if (res.status === HTTP_UNAUTHORIZED || res.status === HTTP_FORBIDDEN) {
      cleanup();
      throw new CrawlError('session_expired', { ...detail, status: res.status });
    }

    if (isRetryableStatus(res.status)) {
      const code = res.status === HTTP_TOO_MANY_REQUESTS ? 'rate_limited' : 'upstream_error';
      lastError = new CrawlError(code, { ...detail, status: res.status });
      // 서버가 언제 다시 오라고 했으면 그 지시를 따른다 (백오프보다 우선)
      forcedDelayMs = retryAfterMs(res);
      cleanup();
      if (attempt === maxRetries) throw lastError;
      continue;
    }

    if (!res.ok) {
      cleanup();
      throw new CrawlError('upstream_error', { ...detail, status: res.status });
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      cleanup();
      // 본문 단계에서 끊긴 것과, 본문이 JSON 이 아닌 것을 구분한다
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = toTransportError(err);
        if (isAborted()) throw lastError;
        if (attempt === maxRetries) throw lastError;
        continue;
      }
      throw new CrawlError(
        'schema_mismatch',
        { ...detail, status: res.status, reason: 'JSON 으로 해석할 수 없는 응답입니다' },
        err,
      );
    }
    cleanup();

    if (options.contractId) {
      await assertJsonContract(options.contractId, res.status, payload, detail);
    }

    return payload as T;
  }

  // 위 반복문은 반드시 return 하거나 throw 한다. 여기 오면 논리 오류다.
  throw lastError ?? new CrawlError('network', { ...detail, reason: '재시도 경로가 비정상 종료' });
}

/**
 * 응답이 레지스트리에 등록된 JSON 계약을 지키는지 확인하고, 아니면 던진다.
 *
 * 응답 **값** 은 에러에 담지 않는다. 어떤 키가 없어졌는지만 남긴다 (P-7).
 */
export async function assertJsonContract(
  contractId: string,
  status: number,
  payload: unknown,
  detail: { source: string; endpoint: string },
): Promise<void> {
  const entry = await getEntry(contractId);
  if (entry.kind !== 'json') {
    throw new Error(`[crawl] JSON 계약이 아닙니다: ${contractId} (kind=${entry.kind})`);
  }
  const result = checkJsonContract(status, payload, entry.contract as JsonContract);
  if (!result.ok) {
    throw new CrawlError('schema_mismatch', {
      ...detail,
      status,
      reason: `${result.reason} (계약: ${contractId})`,
    });
  }
}

/** 쿠키 이름/값 쌍을 HTTP `Cookie` 헤더로 합친다. */
export function buildCookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
