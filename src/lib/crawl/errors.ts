/**
 * 수집 실패의 타입 있는 사유.
 *
 * 출처: market-research-toolkit 의 "매체 안에서는 삼키고, 매체 경계에서는 던진다" 규약 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 명시 에러), §1 P-7 (시크릿 노출 금지)
 *
 * ── 왜 코드를 나누는가 ───────────────────────────────────
 * 지금까지는 "토큰 만료"와 "서버 장애"와 "응답 구조 변경"이 전부 같은 `Error` 로
 * 뭉개졌다. 사용자는 셋 다 "실패했어요"만 보고 무엇을 해야 하는지 알 수 없었다.
 * 코드를 나누면 각 실패가 **사용자가 할 행동**으로 번역된다:
 *   session_expired → 설정에서 쿠키 다시 넣기
 *   rate_limited    → 잠시 뒤 다시
 *   schema_mismatch → 개발자에게 알리기 (사이트가 바뀜)
 *
 * ── URL 을 절대 담지 않는 이유 ───────────────────────────
 * 내부 API 는 토큰을 쿼리스트링에 실어 보내는 경우가 있다. 에러에 URL 을 담으면
 * 그 토큰이 로그·DB·HTTP 응답으로 그대로 새어 나간다 (P-7). 그래서 사람이
 * 위치를 알아볼 정도의 라벨(`source` + `endpoint`)만 싣는다.
 */

/** 수집 실패 종류. */
export type CrawlErrorCode =
  /** 쿠키/토큰이 아예 없음 — 사용자가 설정에서 넣어야 한다 */
  | 'no_credential'
  /** 인증이 만료됨 (401/403) — 사용자가 재발급해야 한다 */
  | 'session_expired'
  /** 호출 한도 (429) — 기다렸다 다시 */
  | 'rate_limited'
  /** 응답은 왔는데 우리가 아는 모양이 아님 — 사이트가 바뀌었다 */
  | 'schema_mismatch'
  /** DOM 셀렉터 계약 실패 — 사이트가 바뀌었다 */
  | 'contract_failed'
  /** 연결 자체가 안 됨 */
  | 'network'
  /** 제한 시간 초과 */
  | 'timeout'
  /** 상대 서버가 5xx 등으로 실패 */
  | 'upstream_error';

/** HTTP 상태로 옮길 때 쓰는 표. 새 코드를 추가하면 여기서 컴파일 에러가 난다. */
export const CRAWL_ERROR_HTTP_STATUS: Record<CrawlErrorCode, number> = {
  no_credential: 428,
  session_expired: 401,
  rate_limited: 429,
  schema_mismatch: 502,
  contract_failed: 502,
  network: 502,
  timeout: 504,
  upstream_error: 502,
};

/** 사용자가 무엇을 해야 하는지. UI 안내에 그대로 쓴다. */
export const CRAWL_ERROR_ACTION: Record<CrawlErrorCode, string> = {
  no_credential: '설정 화면에서 연결 정보를 입력하세요.',
  session_expired: '설정 화면에서 연결 정보를 다시 발급받아 입력하세요.',
  rate_limited: '잠시 후 다시 시도하세요.',
  schema_mismatch: '대상 사이트의 응답 구조가 바뀌었습니다. 개발자 확인이 필요합니다.',
  contract_failed: '대상 사이트의 화면 구조가 바뀌었습니다. 개발자 확인이 필요합니다.',
  network: '네트워크 상태를 확인하고 다시 시도하세요.',
  timeout: '대상 사이트 응답이 느립니다. 잠시 후 다시 시도하세요.',
  upstream_error: '대상 사이트에 문제가 있습니다. 잠시 후 다시 시도하세요.',
};

export interface CrawlErrorDetail {
  /** 어느 수집원인가 (`sellochomes`, `itemscout`, `naver` …) */
  source: string;
  /** 사람이 알아볼 엔드포인트 라벨. **URL 전문을 넣지 않는다** */
  endpoint: string;
  /** HTTP 상태 (있으면) */
  status?: number | undefined;
  /** 계약/스키마 실패 사유 (값 자체는 담지 않는다) */
  reason?: string | undefined;
}

/** 수집 실패. 조용한 빈 결과 대신 이걸 던진다. */
export class CrawlError extends Error {
  public readonly code: CrawlErrorCode;
  public readonly source: string;
  public readonly endpoint: string;
  public readonly status: number | undefined;
  public readonly reason: string | undefined;

  constructor(code: CrawlErrorCode, detail: CrawlErrorDetail, cause?: unknown) {
    const parts = [`[crawl:${detail.source}] ${detail.endpoint} — ${code}`];
    if (detail.status !== undefined) parts.push(`(HTTP ${detail.status})`);
    if (detail.reason) parts.push(`: ${detail.reason}`);
    parts.push(`\n  ${CRAWL_ERROR_ACTION[code]}`);
    super(parts.join(' '), cause !== undefined ? { cause } : undefined);

    this.name = 'CrawlError';
    this.code = code;
    this.source = detail.source;
    this.endpoint = detail.endpoint;
    this.status = detail.status;
    this.reason = detail.reason;
  }

  /** 이 실패를 HTTP 응답으로 옮길 때의 상태 코드. */
  get httpStatus(): number {
    return CRAWL_ERROR_HTTP_STATUS[this.code];
  }

  /** 사용자에게 보여 줄 안내 문구. */
  get userAction(): string {
    return CRAWL_ERROR_ACTION[this.code];
  }
}

/** unknown 을 CrawlError 로 좁힌다. */
export function isCrawlError(err: unknown): err is CrawlError {
  return err instanceof CrawlError;
}
