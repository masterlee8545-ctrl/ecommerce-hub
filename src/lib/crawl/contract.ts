/**
 * JSON 계약 검증기 (Node 측).
 *
 * 출처: market-research-toolkit `registry/contract.py` 의 `check_url` / `json_path` 이식.
 * ADR: docs/ADR-014.md
 *
 * CSS 계약은 DOM 이 필요해 브라우저 안에서 돈다 (`dom-probe.ts`).
 * JSON 계약은 응답 객체만 있으면 되므로 여기서 판정한다.
 *
 * 이게 필요한 이유: 외부 사이트의 내부 API 는 예고 없이 응답 모양이 바뀐다.
 * 지금 코드는 모양이 바뀌면 `return []` 로 조용히 빈 배열을 돌려주는데(P-1 위반),
 * 계약을 걸어 두면 "무엇이 없어졌는지"가 에러 메시지에 남는다.
 */

import type { CheckResult, JsonContract } from './types';

const DEFAULT_EXPECTED_STATUS = 200;

/**
 * `data.items` 같은 점 표기 경로가 payload 안에 **존재하는지**.
 *
 * 객체만 따라간다. 배열 인덱싱은 지원하지 않는다 (원본과 동일).
 * 값이 `null` 이어도 키가 있으면 존재로 본다 — "키 자체가 사라짐"과
 * "값이 비었음"은 다른 사건이기 때문이다.
 */
export function jsonPathExists(payload: unknown, dotted: string): boolean {
  let current: unknown = payload;
  for (const part of dotted.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

/** 점 표기 경로가 가리키는 **값**. 없으면 undefined. */
export function jsonPathGet(payload: unknown, dotted: string): unknown {
  if (!dotted) return undefined;
  let current: unknown = payload;
  for (const part of dotted.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * API 응답이 계약을 만족하는지 본다. 예외를 던지지 않고 판정 결과로 돌려준다.
 *
 * @param status  HTTP 상태. 응답을 아예 못 받았으면 null
 * @param payload 파싱된 응답 본문
 * @param spec    계약
 * @param error   네트워크 단계에서 이미 실패했다면 그 사유
 */
export function checkJsonContract(
  status: number | null,
  payload: unknown,
  spec: JsonContract,
  error?: string,
): CheckResult {
  if (error) {
    return { ok: false, matches: 0, reason: `요청 실패: ${error}` };
  }

  const expected = spec.status ?? DEFAULT_EXPECTED_STATUS;
  if (status !== expected) {
    if (status === null) {
      return { ok: false, matches: 0, reason: `응답을 받지 못했습니다 (기대 상태 ${expected})` };
    }
    return { ok: false, matches: 0, reason: `상태 ${status} (기대 ${expected})` };
  }

  const missing = (spec.jsonKeys ?? []).filter((key) => !jsonPathExists(payload, key));
  if (missing.length > 0) {
    return { ok: false, matches: 0, reason: `응답에 없는 키: ${missing.join(', ')}` };
  }

  return { ok: true, matches: 1, reason: `상태 ${status}, 필요한 키 모두 존재` };
}
