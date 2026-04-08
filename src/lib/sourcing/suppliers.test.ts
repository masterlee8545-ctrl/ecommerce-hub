/**
 * 공급사 도메인 단위 테스트
 *
 * 출처: src/lib/sourcing/suppliers.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * 검증 항목:
 * 1. SUPPLIER_SOURCES 상수 무결성 (4종)
 * 2. createSupplier — 입력 검증 (이름/source/rating)
 * 3. updateSupplier — 입력 검증
 *
 * 주의: 실제 DB를 호출하지 않는다. validation 부분만 확인.
 */
import { describe, expect, it } from 'vitest';

import {
  SUPPLIER_SOURCES,
  createSupplier,
  updateSupplier,
  type SupplierSource,
} from './suppliers';

// ─────────────────────────────────────────────────────────
// 1. 상수 무결성
// ─────────────────────────────────────────────────────────

describe('SUPPLIER_SOURCES — 상수 무결성', () => {
  it('4종 출처 정의됨', () => {
    const EXPECTED_COUNT = 4;
    expect(SUPPLIER_SOURCES).toHaveLength(EXPECTED_COUNT);
  });

  it('1688, taobao, domestic, other 모두 포함', () => {
    expect(SUPPLIER_SOURCES).toContain('1688');
    expect(SUPPLIER_SOURCES).toContain('taobao');
    expect(SUPPLIER_SOURCES).toContain('domestic');
    expect(SUPPLIER_SOURCES).toContain('other');
  });
});

// ─────────────────────────────────────────────────────────
// 2. createSupplier — 입력 검증
// ─────────────────────────────────────────────────────────

describe('createSupplier — 입력 검증 (DB 호출 전 단계)', () => {
  const baseInput = {
    companyId: '00000000-0000-0000-0000-000000000001',
    name: '杭州XX贸易有限公司',
    source: '1688' as SupplierSource,
  };

  it('companyId 누락 시 throw', async () => {
    await expect(
      createSupplier({ ...baseInput, companyId: '' }),
    ).rejects.toThrow('companyId');
  });

  it('이름이 빈 문자열이면 throw', async () => {
    await expect(
      createSupplier({ ...baseInput, name: '' }),
    ).rejects.toThrow('이름이 비어');
  });

  it('이름이 공백만이면 throw', async () => {
    await expect(
      createSupplier({ ...baseInput, name: '   ' }),
    ).rejects.toThrow('이름이 비어');
  });

  it('이름이 200자 초과면 throw', async () => {
    const TOO_LONG = 201;
    await expect(
      createSupplier({ ...baseInput, name: 'a'.repeat(TOO_LONG) }),
    ).rejects.toThrow('너무 깁니다');
  });

  it('source가 유효하지 않으면 throw', async () => {
    await expect(
      createSupplier({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        source: 'invalid',
      }),
    ).rejects.toThrow('source');
  });

  it('rating이 0이면 throw (1~5 범위 밖)', async () => {
    await expect(
      createSupplier({ ...baseInput, rating: 0 }),
    ).rejects.toThrow('1~5');
  });

  it('rating이 6이면 throw', async () => {
    const ABOVE_MAX = 6;
    await expect(
      createSupplier({ ...baseInput, rating: ABOVE_MAX }),
    ).rejects.toThrow('1~5');
  });

  it('rating이 1.5면 throw (정수 아님)', async () => {
    const NON_INT = 1.5;
    await expect(
      createSupplier({ ...baseInput, rating: NON_INT }),
    ).rejects.toThrow('정수');
  });

  it('rating이 null이면 통과 (검증 단계)', async () => {
    // null은 유효 — 평가 안 함을 의미
    // DB까지 가지 않고 그 전에 멈출 것이므로 다른 에러가 나도 OK
    // 단, "1~5" 메시지의 에러는 절대 안 나와야 함
    try {
      await createSupplier({ ...baseInput, rating: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('1~5');
    }
  });
});

// ─────────────────────────────────────────────────────────
// 3. updateSupplier — 입력 검증
// ─────────────────────────────────────────────────────────

describe('updateSupplier — 입력 검증', () => {
  const baseInput = {
    companyId: '00000000-0000-0000-0000-000000000001',
    supplierId: '00000000-0000-0000-0000-000000000002',
  };

  it('companyId 누락 시 throw', async () => {
    await expect(
      updateSupplier({ ...baseInput, companyId: '' }),
    ).rejects.toThrow('companyId');
  });

  it('supplierId 누락 시 throw', async () => {
    await expect(
      updateSupplier({ ...baseInput, supplierId: '' }),
    ).rejects.toThrow('supplierId');
  });

  it('source 변경 시 잘못된 값이면 throw', async () => {
    await expect(
      updateSupplier({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        source: 'invalid',
      }),
    ).rejects.toThrow('source');
  });

  it('rating 변경 시 범위 밖이면 throw', async () => {
    const ABOVE_MAX = 99;
    await expect(
      updateSupplier({ ...baseInput, rating: ABOVE_MAX }),
    ).rejects.toThrow('1~5');
  });

  it('이름만 변경 시 빈 문자열이면 throw', async () => {
    await expect(
      updateSupplier({ ...baseInput, name: '' }),
    ).rejects.toThrow('이름이 비어');
  });
});
