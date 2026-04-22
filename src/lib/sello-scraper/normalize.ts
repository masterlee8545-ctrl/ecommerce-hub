/**
 * 셀록홈즈 스크래퍼 원본 문자열 → 숫자 정규화.
 *
 * 셀록홈즈 UI 포맷:
 *   - 판매수: "9.14천" (=9140), "359" (1000 미만은 그대로), "-" (데이터 없음)
 *   - 금액:   "8310.08만원" (=83,100,800원), "1.43억원" (=143,000,000원), "3.57만원", "9,090원"
 *   - 퍼센트: "15.45%" → 0.1545 (decimal 0~1 범위로 보관)
 *   - 정수:   "59,163" (콤마), "9142"
 *   - 가격:   "9,090원", "1,152원\n    구매" (개행·공백 포함)
 *
 * 정책:
 *   - 모든 함수는 입력이 null/undefined/"-"/빈 문자열/파싱 실패이면 null 반환.
 *   - NaN/Infinity는 null로 변환.
 */

function isBlank(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed === '-') return true;
  return false;
}

function finite(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * "9.14천" → 9140, "359" → 359, "14,070" → 14070, "-" → null.
 * 소수점 허용. 접미사는 "천"만 인식.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().replace(/,/g, '');
  const match = s.match(/^(-?\d+(?:\.\d+)?)\s*(천)?/);
  if (!match || match[1] === undefined) return null;
  const base = parseFloat(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(base)) return null;
  const multiplier = suffix === '천' ? 1000 : 1;
  return finite(Math.round(base * multiplier));
}

/**
 * 원 단위 금액 파싱.
 * "8310.08만원" → 83_100_800, "1.43억원" → 143_000_000, "3.57만원" → 35_700,
 * "9,090원" → 9090, "1,152원\n    구매" → 1152, "-" → null.
 *
 * 우선순위: "억" > "만" > "원" (접미사). 접미사 없으면 숫자 그대로.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  // 개행·중복 공백을 단일 공백으로 (예: "1,152원\n    구매")
  const s = String(raw).replace(/\s+/g, ' ').trim().replace(/,/g, '');
  const match = s.match(/^(-?\d+(?:\.\d+)?)\s*(억|만)?\s*원?/);
  if (!match || match[1] === undefined) return null;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2];
  let multiplier = 1;
  if (suffix === '억') multiplier = 100_000_000;
  else if (suffix === '만') multiplier = 10_000;
  return finite(Math.round(base * multiplier));
}

/**
 * "15.45%" → 0.1545 (0~1 decimal). "-" → null.
 */
export function parsePercent(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  const match = s.match(/^(-?\d+(?:\.\d+)?)\s*%?$/);
  if (!match || match[1] === undefined) return null;
  const v = parseFloat(match[1]);
  if (!Number.isFinite(v)) return null;
  return finite(v / 100);
}

/**
 * "59,163" → 59163, "9142" → 9142, "-" → null.
 * 콤마 제거 후 parseInt (소수 있으면 parse fail → null).
 */
export function parseInteger(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  return finite(parseInt(s, 10));
}

/**
 * parseAmount 의 별칭 — 가격 필드 전용(가독성용).
 */
export function parsePrice(raw: string | null | undefined): number | null {
  return parseAmount(raw);
}

/**
 * rank는 보통 "1" ~ "20" 문자열. parseInteger 래퍼이지만
 * 의미가 다르므로 명시적 함수로 제공.
 */
export function parseRank(raw: string | null | undefined): number | null {
  return parseInteger(raw);
}
