/**
 * JSON 응답 계약 테스트.
 *
 * 핵심은 "키가 사라졌다"와 "값이 비었다"를 구분하는가다.
 * 둘을 뭉개면 사이트가 응답 구조를 바꿔도 화면에는 "데이터 없음"으로만 보인다.
 */
import { describe, expect, it } from 'vitest';

import { checkJsonContract, jsonPathExists, jsonPathGet } from './contract';

describe('jsonPathExists', () => {
  const payload = { data: { items: [1, 2], empty: null }, top: 1 };

  it('점 표기 경로를 따라간다', () => {
    expect(jsonPathExists(payload, 'data.items')).toBe(true);
    expect(jsonPathExists(payload, 'top')).toBe(true);
  });

  it('값이 null 이어도 키가 있으면 존재로 본다', () => {
    // "키가 사라짐"과 "값이 비었음"은 다른 사건이다
    expect(jsonPathExists(payload, 'data.empty')).toBe(true);
  });

  it('없는 경로는 false', () => {
    expect(jsonPathExists(payload, 'data.gone')).toBe(false);
    expect(jsonPathExists(payload, 'nope.deeper')).toBe(false);
  });

  it('배열을 객체처럼 파고들지 않는다', () => {
    expect(jsonPathExists(payload, 'data.items.0')).toBe(false);
  });

  it('payload 가 객체가 아니면 false', () => {
    expect(jsonPathExists(null, 'a')).toBe(false);
    expect(jsonPathExists('문자열', 'a')).toBe(false);
  });
});

describe('jsonPathGet', () => {
  it('경로가 가리키는 값을 준다', () => {
    expect(jsonPathGet({ a: { b: 7 } }, 'a.b')).toBe(7);
  });

  it('없으면 undefined', () => {
    expect(jsonPathGet({ a: 1 }, 'a.b')).toBeUndefined();
    expect(jsonPathGet({ a: 1 }, '')).toBeUndefined();
  });
});

describe('checkJsonContract', () => {
  it('상태와 키가 모두 맞으면 통과', () => {
    const result = checkJsonContract(200, { data: { items: [] } }, {
      status: 200,
      jsonKeys: ['data.items'],
    });
    expect(result.ok).toBe(true);
  });

  it('없어진 키를 사유에 그대로 적는다', () => {
    const result = checkJsonContract(200, { data: {} }, {
      status: 200,
      jsonKeys: ['data.items', 'data.total'],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('data.items');
    expect(result.reason).toContain('data.total');
  });

  it('상태가 다르면 실패', () => {
    const result = checkJsonContract(500, {}, { status: 200 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('500');
  });

  it('응답을 못 받았으면 그 사실을 알려 준다', () => {
    const result = checkJsonContract(null, null, { status: 200 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('응답을 받지 못했습니다');
  });

  it('네트워크 단계에서 이미 실패했으면 그 사유를 앞세운다', () => {
    const result = checkJsonContract(null, null, { status: 200 }, 'ECONNRESET');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ECONNRESET');
  });

  it('기대 상태를 안 적으면 200 으로 본다', () => {
    expect(checkJsonContract(200, {}, {}).ok).toBe(true);
    expect(checkJsonContract(204, {}, {}).ok).toBe(false);
  });
});
