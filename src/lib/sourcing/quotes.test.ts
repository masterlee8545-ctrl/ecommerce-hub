/**
 * 견적(quotes) 도메인 단위 테스트
 *
 * 출처: src/lib/sourcing/quotes.ts, constants.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-9 (사용자 친화 한국어)
 *
 * 검증 항목:
 * 1. 상수 무결성 — QUOTE_STATUSES / OPEN_QUOTE_STATUSES / QUOTE_STATUS_META / DEFAULT_VAT_RATE
 * 2. toPriceWithVat / toPriceWithoutVat — VAT 포함/별도 계산
 * 3. createQuote — 입력 검증 (companyId, 단가, VAT율, MOQ, 리드타임, 문자열 길이)
 * 4. updateQuote — 입력 검증 (accepted 전환 차단, 부분 수정 검증)
 * 5. acceptQuote / getQuoteById / bulkInsertQuotes — 필수 파라미터 검증
 *
 * 주의:
 * - 실제 DB는 호출하지 않는다. 검증 단계(throw)까지만 확인.
 * - DB까지 가는 테스트는 smoke.test.ts 가 별도로 다룬다.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VAT_RATE,
  OPEN_QUOTE_STATUSES,
  QUOTE_STATUSES,
  QUOTE_STATUS_META,
  toPriceWithVat,
  toPriceWithoutVat,
  type QuoteStatus,
} from './constants';
import {
  acceptQuote,
  bulkInsertQuotes,
  createQuote,
  getQuoteById,
  listQuotesForProduct,
  listQuotesWithRelations,
  parseQuoteStatusFilter,
  updateQuote,
} from './quotes';

// ─────────────────────────────────────────────────────────
// 테스트 상수 (no-magic-numbers 회피용)
// ─────────────────────────────────────────────────────────

const FAKE_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_PRODUCT_ID = '00000000-0000-0000-0000-000000000002';
const FAKE_SUPPLIER_ID = '00000000-0000-0000-0000-000000000003';
const FAKE_QUOTE_ID = '00000000-0000-0000-0000-000000000004';

const EXPECTED_QUOTE_STATUS_COUNT = 4;
const EXPECTED_OPEN_STATUS_COUNT = 2;
const EXPECTED_DEFAULT_VAT = 0.1;

const SAMPLE_UNIT_PRICE_KRW = 10000;
const NEGATIVE_PRICE = -1;
const VAT_10_PERCENT = 0.1;
const VAT_OVER_LIMIT = 1.5;
const VAT_NEGATIVE = -0.1;

const VALID_MOQ = 100;
const FRACTIONAL_MOQ = 1.5;
const NEGATIVE_MOQ = -10;

const VALID_LEAD_TIME = 14;
const NEGATIVE_LEAD_TIME = -1;
const FRACTIONAL_LEAD_TIME = 7.5;

const MAX_NOTES_LEN = 2000;
const MAX_SPEC_LEN = 2000;
const MAX_PAYMENT_TERMS_LEN = 500;
const OVERFLOW_NOTES_LEN = MAX_NOTES_LEN + 1;
const OVERFLOW_SPEC_LEN = MAX_SPEC_LEN + 1;
const OVERFLOW_PAYMENT_LEN = MAX_PAYMENT_TERMS_LEN + 1;

const VAT_INCLUSIVE_MULTIPLIER = 1.1; // 1 + 10%
const PRICE_WITH_VAT_INCLUDED = 11000;

// ─────────────────────────────────────────────────────────
// 1. 상수 무결성
// ─────────────────────────────────────────────────────────

describe('QUOTE_STATUSES — 상수 무결성', () => {
  it('4종 상태 정의됨', () => {
    expect(QUOTE_STATUSES).toHaveLength(EXPECTED_QUOTE_STATUS_COUNT);
  });

  it('requested/received/accepted/rejected 모두 포함', () => {
    expect(QUOTE_STATUSES).toContain('requested');
    expect(QUOTE_STATUSES).toContain('received');
    expect(QUOTE_STATUSES).toContain('accepted');
    expect(QUOTE_STATUSES).toContain('rejected');
  });

  it('QUOTE_STATUS_META가 모든 상태에 대한 한국어 라벨을 가짐 (P-9)', () => {
    for (const status of QUOTE_STATUSES) {
      expect(QUOTE_STATUS_META[status]).toBeDefined();
      expect(QUOTE_STATUS_META[status].label).toBeTruthy();
      expect(QUOTE_STATUS_META[status].description).toBeTruthy();
    }
  });

  it('OPEN_QUOTE_STATUSES = requested + received (비교 대상)', () => {
    expect(OPEN_QUOTE_STATUSES).toHaveLength(EXPECTED_OPEN_STATUS_COUNT);
    expect(OPEN_QUOTE_STATUSES).toContain('requested');
    expect(OPEN_QUOTE_STATUSES).toContain('received');
    expect(OPEN_QUOTE_STATUSES).not.toContain('accepted');
    expect(OPEN_QUOTE_STATUSES).not.toContain('rejected');
  });
});

describe('DEFAULT_VAT_RATE — 한국 기본 부가세율', () => {
  it('10% (0.1) 이어야 함', () => {
    expect(DEFAULT_VAT_RATE).toBe(EXPECTED_DEFAULT_VAT);
  });
});

// ─────────────────────────────────────────────────────────
// 2. toPriceWithVat / toPriceWithoutVat
// ─────────────────────────────────────────────────────────

describe('toPriceWithVat — VAT 포함 최종단가 계산', () => {
  it('vatIncluded=true면 그대로 반환', () => {
    expect(toPriceWithVat(PRICE_WITH_VAT_INCLUDED, VAT_10_PERCENT, true)).toBe(
      PRICE_WITH_VAT_INCLUDED,
    );
  });

  it('vatIncluded=false면 (1 + vatRate) 곱함', () => {
    expect(toPriceWithVat(SAMPLE_UNIT_PRICE_KRW, VAT_10_PERCENT, false)).toBe(
      SAMPLE_UNIT_PRICE_KRW * VAT_INCLUSIVE_MULTIPLIER,
    );
  });

  it('vatRate=0이면 unitPrice 그대로', () => {
    expect(toPriceWithVat(SAMPLE_UNIT_PRICE_KRW, 0, false)).toBe(SAMPLE_UNIT_PRICE_KRW);
  });
});

describe('toPriceWithoutVat — VAT 포함가 → 별도가 역산', () => {
  it('포함가를 (1 + vatRate)로 나눈 값', () => {
    const inclusivePrice = SAMPLE_UNIT_PRICE_KRW * VAT_INCLUSIVE_MULTIPLIER;
    expect(toPriceWithoutVat(inclusivePrice, VAT_10_PERCENT)).toBeCloseTo(SAMPLE_UNIT_PRICE_KRW);
  });
});

// ─────────────────────────────────────────────────────────
// 3. createQuote — 입력 검증
// ─────────────────────────────────────────────────────────

describe('createQuote — 입력 검증 (DB 호출 전 단계)', () => {
  const baseInput = {
    companyId: FAKE_COMPANY_ID,
    productId: FAKE_PRODUCT_ID,
    supplierId: FAKE_SUPPLIER_ID,
    unitPriceKrw: SAMPLE_UNIT_PRICE_KRW,
  };

  it('companyId 누락 시 throw', async () => {
    await expect(createQuote({ ...baseInput, companyId: '' })).rejects.toThrow('companyId');
  });

  it('status가 유효하지 않으면 throw', async () => {
    await expect(
      createQuote({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        status: 'invalid-status',
      }),
    ).rejects.toThrow('상태값');
  });

  it('unit_price_krw가 음수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, unitPriceKrw: NEGATIVE_PRICE }),
    ).rejects.toThrow('0 이상');
  });

  it('unit_price_cny가 음수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, unitPriceCny: NEGATIVE_PRICE }),
    ).rejects.toThrow('0 이상');
  });

  it('vatRate가 1 초과면 throw (0~1 범위)', async () => {
    await expect(
      createQuote({ ...baseInput, vatRate: VAT_OVER_LIMIT }),
    ).rejects.toThrow('0~1');
  });

  it('vatRate가 음수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, vatRate: VAT_NEGATIVE }),
    ).rejects.toThrow('0~1');
  });

  it('moq가 0이면 throw (양의 정수)', async () => {
    await expect(createQuote({ ...baseInput, moq: 0 })).rejects.toThrow('양의 정수');
  });

  it('moq가 음수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, moq: NEGATIVE_MOQ }),
    ).rejects.toThrow('양의 정수');
  });

  it('moq가 소수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, moq: FRACTIONAL_MOQ }),
    ).rejects.toThrow('양의 정수');
  });

  it('leadTimeDays가 음수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, leadTimeDays: NEGATIVE_LEAD_TIME }),
    ).rejects.toThrow('0 이상');
  });

  it('leadTimeDays가 소수면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, leadTimeDays: FRACTIONAL_LEAD_TIME }),
    ).rejects.toThrow('정수');
  });

  it('notes가 2000자 초과면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, notes: 'a'.repeat(OVERFLOW_NOTES_LEN) }),
    ).rejects.toThrow('너무 깁니다');
  });

  it('specText가 2000자 초과면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, specText: 'a'.repeat(OVERFLOW_SPEC_LEN) }),
    ).rejects.toThrow('너무 깁니다');
  });

  it('paymentTerms가 500자 초과면 throw', async () => {
    await expect(
      createQuote({ ...baseInput, paymentTerms: 'a'.repeat(OVERFLOW_PAYMENT_LEN) }),
    ).rejects.toThrow('너무 깁니다');
  });

  it('vatRate=0.1 (DEFAULT_VAT_RATE)은 유효 — 검증 통과', async () => {
    // 검증 단계에서 "0~1" 에러가 나면 안 됨 (DB 단계 에러는 OK)
    try {
      await createQuote({ ...baseInput, vatRate: VAT_10_PERCENT });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('0~1');
    }
  });

  it('moq=양의 정수는 유효', async () => {
    try {
      await createQuote({ ...baseInput, moq: VALID_MOQ });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('양의 정수');
    }
  });

  it('leadTimeDays=양의 정수는 유효', async () => {
    try {
      await createQuote({ ...baseInput, leadTimeDays: VALID_LEAD_TIME });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('lead_time_days');
    }
  });
});

// ─────────────────────────────────────────────────────────
// 4. updateQuote — 입력 검증
// ─────────────────────────────────────────────────────────

describe('updateQuote — 입력 검증', () => {
  const baseInput = {
    companyId: FAKE_COMPANY_ID,
    quoteId: FAKE_QUOTE_ID,
  };

  it('companyId 누락 시 throw', async () => {
    await expect(updateQuote({ ...baseInput, companyId: '' })).rejects.toThrow('companyId');
  });

  it('quoteId 누락 시 throw', async () => {
    await expect(updateQuote({ ...baseInput, quoteId: '' })).rejects.toThrow('quoteId');
  });

  it('accepted 상태로의 전환은 차단 (acceptQuote 전용)', async () => {
    await expect(
      updateQuote({ ...baseInput, status: 'accepted' }),
    ).rejects.toThrow('acceptQuote');
  });

  it('rejected 전환은 허용 (검증 단계에서 throw 없음)', async () => {
    // DB 단계까지 가도 OK — 검증 에러만 없으면 됨
    try {
      await updateQuote({ ...baseInput, status: 'rejected' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('acceptQuote');
    }
  });

  it('vatRate 범위 밖이면 throw', async () => {
    await expect(
      updateQuote({ ...baseInput, vatRate: VAT_OVER_LIMIT }),
    ).rejects.toThrow('0~1');
  });

  it('moq가 소수면 throw', async () => {
    await expect(
      updateQuote({ ...baseInput, moq: FRACTIONAL_MOQ }),
    ).rejects.toThrow('양의 정수');
  });

  it('notes가 2000자 초과면 throw', async () => {
    await expect(
      updateQuote({ ...baseInput, notes: 'a'.repeat(OVERFLOW_NOTES_LEN) }),
    ).rejects.toThrow('너무 깁니다');
  });
});

// ─────────────────────────────────────────────────────────
// 5. 기타 함수 — 필수 파라미터 검증
// ─────────────────────────────────────────────────────────

describe('getQuoteById — 필수 파라미터 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(getQuoteById('', FAKE_QUOTE_ID)).rejects.toThrow('companyId');
  });

  it('quoteId 누락 시 throw', async () => {
    await expect(getQuoteById(FAKE_COMPANY_ID, '')).rejects.toThrow('quoteId');
  });
});

describe('listQuotesForProduct — 필수 파라미터 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      listQuotesForProduct({ companyId: '', productId: FAKE_PRODUCT_ID }),
    ).rejects.toThrow('companyId');
  });

  it('productId 누락 시 throw', async () => {
    await expect(
      listQuotesForProduct({ companyId: FAKE_COMPANY_ID, productId: '' }),
    ).rejects.toThrow('productId');
  });
});

describe('acceptQuote — 필수 파라미터 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      acceptQuote({ companyId: '', quoteId: FAKE_QUOTE_ID }),
    ).rejects.toThrow('companyId');
  });

  it('quoteId 누락 시 throw', async () => {
    await expect(
      acceptQuote({ companyId: FAKE_COMPANY_ID, quoteId: '' }),
    ).rejects.toThrow('quoteId');
  });
});

describe('bulkInsertQuotes — 필수 파라미터 검증', () => {
  const baseBulk = {
    companyId: FAKE_COMPANY_ID,
    sourceFileName: 'test.xlsx',
    rows: [
      {
        productId: FAKE_PRODUCT_ID,
        supplierId: FAKE_SUPPLIER_ID,
        unitPriceKrw: SAMPLE_UNIT_PRICE_KRW,
        sourceRow: 2,
      },
    ],
  };

  it('companyId 누락 시 throw', async () => {
    await expect(
      bulkInsertQuotes({ ...baseBulk, companyId: '' }),
    ).rejects.toThrow('companyId');
  });

  it('sourceFileName 누락 시 throw', async () => {
    await expect(
      bulkInsertQuotes({ ...baseBulk, sourceFileName: '' }),
    ).rejects.toThrow('sourceFileName');
  });

  it('rows 비어있으면 throw', async () => {
    await expect(
      bulkInsertQuotes({ ...baseBulk, rows: [] }),
    ).rejects.toThrow('삽입할 행');
  });

  it('row 내부 단가가 음수면 행 번호 포함해서 throw', async () => {
    await expect(
      bulkInsertQuotes({
        ...baseBulk,
        rows: [
          {
            productId: FAKE_PRODUCT_ID,
            supplierId: FAKE_SUPPLIER_ID,
            unitPriceKrw: NEGATIVE_PRICE,
            sourceRow: 5,
          },
        ],
      }),
    ).rejects.toThrow(/행 5/);
  });

  it('row 내부 vatRate가 범위 밖이면 행 번호 포함해서 throw', async () => {
    await expect(
      bulkInsertQuotes({
        ...baseBulk,
        rows: [
          {
            productId: FAKE_PRODUCT_ID,
            supplierId: FAKE_SUPPLIER_ID,
            unitPriceKrw: SAMPLE_UNIT_PRICE_KRW,
            vatRate: VAT_OVER_LIMIT,
            sourceRow: 7,
          },
        ],
      }),
    ).rejects.toThrow(/행 7/);
  });
});

// ─────────────────────────────────────────────────────────
// 6. QuoteStatus 타입 (컴파일 타임 검사)
// ─────────────────────────────────────────────────────────

describe('QuoteStatus — 타입 체커', () => {
  it('QUOTE_STATUSES의 원소가 QuoteStatus 타입에 할당 가능', () => {
    const status: QuoteStatus = QUOTE_STATUSES[0];
    expect(QUOTE_STATUSES).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────
// 7. parseQuoteStatusFilter (F-4)
// ─────────────────────────────────────────────────────────

describe('parseQuoteStatusFilter — URL 쿼리 파싱', () => {
  it('null / undefined / 빈 문자열이면 빈 배열', () => {
    expect(parseQuoteStatusFilter(null)).toEqual([]);
    expect(parseQuoteStatusFilter(undefined)).toEqual([]);
    expect(parseQuoteStatusFilter('')).toEqual([]);
  });

  it('단일 유효값 파싱', () => {
    expect(parseQuoteStatusFilter('received')).toEqual(['received']);
  });

  it('쉼표 구분 복수 파싱', () => {
    const result = parseQuoteStatusFilter('received,requested');
    expect(result).toContain('received');
    expect(result).toContain('requested');
    const EXPECTED_LEN = 2;
    expect(result).toHaveLength(EXPECTED_LEN);
  });

  it('잘못된 값은 조용히 무시하고 유효값만 남김', () => {
    const result = parseQuoteStatusFilter('received,invalid,accepted');
    expect(result).toContain('received');
    expect(result).toContain('accepted');
    expect(result).not.toContain('invalid');
    const EXPECTED_LEN = 2;
    expect(result).toHaveLength(EXPECTED_LEN);
  });

  it('공백이 있어도 trim 적용', () => {
    const result = parseQuoteStatusFilter(' received , rejected ');
    expect(result).toContain('received');
    expect(result).toContain('rejected');
  });

  it('전부 잘못된 값이면 빈 배열', () => {
    expect(parseQuoteStatusFilter('foo,bar,baz')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────
// 8. listQuotesWithRelations — 필수 파라미터 검증 (F-4)
// ─────────────────────────────────────────────────────────

describe('listQuotesWithRelations — 필수 파라미터 검증', () => {
  it('companyId 누락 시 throw (listQuotes 위임)', async () => {
    await expect(listQuotesWithRelations({ companyId: '' })).rejects.toThrow('companyId');
  });
});
