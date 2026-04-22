/**
 * 셀록홈즈 스크래퍼 — 순수 상수만 (Node.js 의존성 없음).
 *
 * 이 파일은 **클라이언트·서버 모두에서 안전하게 import 가능**.
 * metrics.ts / adapter.ts 는 `node:fs/promises` 를 쓰므로 서버 전용 — 클라이언트에서
 * import 하면 webpack UnhandledSchemeError 발생.
 *
 * 규칙: 클라이언트 컴포넌트는 이 파일에서만 import. metrics.ts 는 서버에서만.
 */

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

/** 캐시 기본 TTL — 24시간 (리뷰수·로켓비율·가격은 매일 바뀜) */
export const DEFAULT_CACHE_TTL_MS =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
