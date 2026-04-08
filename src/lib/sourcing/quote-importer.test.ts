/**
 * 견적 엑셀 임포트 파서 단위 테스트 (F-2b)
 *
 * 출처: src/lib/sourcing/quote-importer.ts
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지 — 실패 행 warnings로 드러냄),
 *       §1 P-2 (실패 시 throw), §1 P-9 (사용자 친화)
 *
 * 검증 항목:
 * 1. parseQuoteExcel — 유효한 엑셀을 파싱해 행 배열을 반환
 * 2. 한글/영문 헤더 퍼지 매칭 (공급단가, 단가, KRW 등)
 * 3. 통화 기호/쉼표가 섞인 숫자 파싱
 * 4. VAT율 퍼센트/소수 정규화 (10 → 0.1)
 * 5. VAT 포함 여부 Y/N/포함 퍼지 파싱
 * 6. 빈 행 스킵
 * 7. 잘못된 행은 warnings에 누적되고 다른 행은 그대로 저장 (P-1)
 * 8. 단가 컬럼 부재 → throw
 * 9. 빈 워크시트 → throw
 * 10. 빈 파일명 → throw
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_VAT_RATE } from './constants';
import { parseQuoteExcel } from './quote-importer';

// ─────────────────────────────────────────────────────────
// 테스트 상수
// ─────────────────────────────────────────────────────────

const KRW_10000 = 10000;
const KRW_15000 = 15000;
const KRW_20000 = 20000;
const CNY_50 = 50;
const MOQ_100 = 100;
const MOQ_200 = 200;
const LEAD_14 = 14;
const VAT_10_PERCENT_DECIMAL = 0.1;
const VAT_10_PERCENT_INTEGER = 10;

// ─────────────────────────────────────────────────────────
// 헬퍼: 테스트용 xlsx Buffer 생성
// ─────────────────────────────────────────────────────────

interface TestRow {
  productCode?: string;
  productName?: string;
  supplierName?: string;
  unitPriceKrw?: string | number;
  unitPriceCny?: string | number;
  vatRate?: string | number;
  vatIncluded?: string | boolean;
  moq?: string | number;
  leadTimeDays?: string | number;
  paymentTerms?: string;
  notes?: string;
}

async function buildTestXlsxBuffer(
  headers: string[],
  rows: Array<unknown[]>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('견적');
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow(r);
  }
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

// ─────────────────────────────────────────────────────────
// 1. 유효한 엑셀 파싱
// ─────────────────────────────────────────────────────────

describe('parseQuoteExcel — 정상 파싱', () => {
  it('한국어 헤더 + 2행 데이터를 파싱한다', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품코드', '상품명', '공급사', '공급단가(KRW)', 'MOQ', '납기'],
      [
        ['SKU-001', '무선 이어폰', 'ABC수입', KRW_10000, MOQ_100, LEAD_14],
        ['SKU-002', '블루투스 스피커', 'XYZ무역', KRW_15000, MOQ_200, LEAD_14],
      ],
    );

    const result = await parseQuoteExcel(buffer, 'test.xlsx');

    expect(result.sourceFileName).toBe('test.xlsx');
    const EXPECTED_ROWS = 2;
    expect(result.rows).toHaveLength(EXPECTED_ROWS);
    expect(result.warnings).toHaveLength(0);

    const [row1, row2] = result.rows;
    expect(row1?.rawProductCode).toBe('SKU-001');
    expect(row1?.rawProductName).toBe('무선 이어폰');
    expect(row1?.rawSupplierName).toBe('ABC수입');
    expect(row1?.unitPriceKrw).toBe(KRW_10000);
    expect(row1?.moq).toBe(MOQ_100);
    expect(row1?.leadTimeDays).toBe(LEAD_14);
    expect(row1?.sourceRow).toBe(1); // 헤더 제외 후 1행

    expect(row2?.rawProductCode).toBe('SKU-002');
    expect(row2?.sourceRow).toBe(2);
  });

  it('영문 헤더(KRW, Price)도 인식', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['SKU', 'Product Name', 'Supplier', 'Price(KRW)'],
      [['P001', 'Sample', 'Supplier A', KRW_10000]],
    );

    const result = await parseQuoteExcel(buffer, 'en.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.unitPriceKrw).toBe(KRW_10000);
  });

  it('검출된 컬럼 목록 (detectedColumns)이 원본 헤더를 포함', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [['샘플', KRW_10000]],
    );
    const result = await parseQuoteExcel(buffer, 'detect.xlsx');
    // detectedColumns 형식: "원화단가(공급단가)" 같은 식
    expect(result.detectedColumns.join(',')).toContain('공급단가');
    expect(result.detectedColumns.join(',')).toContain('상품명');
  });
});

// ─────────────────────────────────────────────────────────
// 2. 숫자/통화 기호 파싱
// ─────────────────────────────────────────────────────────

describe('parseQuoteExcel — 숫자 파싱', () => {
  it('통화 기호(₩)와 쉼표를 제거하고 숫자로 인식', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [['샘플', '₩10,000']],
    );
    const result = await parseQuoteExcel(buffer, 'currency.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.unitPriceKrw).toBe(KRW_10000);
  });

  it('위안 단가(CNY)를 별도 컬럼으로 인식', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', 'CNY', '공급단가(KRW)'],
      [['샘플', CNY_50, KRW_10000]],
    );
    const result = await parseQuoteExcel(buffer, 'cny.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.unitPriceCny).toBe(CNY_50);
    expect(result.rows[0]?.unitPriceKrw).toBe(KRW_10000);
  });

  it('원화만 있고 위안이 없으면 unitPriceCny=null', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [['샘플', KRW_10000]],
    );
    const result = await parseQuoteExcel(buffer, 'krw-only.xlsx');
    expect(result.rows[0]?.unitPriceCny ?? null).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// 3. VAT율 정규화
// ─────────────────────────────────────────────────────────

describe('parseQuoteExcel — VAT 정규화', () => {
  it('10(퍼센트 표기)을 0.1로 변환', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가', '부가세율'],
      [['샘플', KRW_10000, VAT_10_PERCENT_INTEGER]],
    );
    const result = await parseQuoteExcel(buffer, 'vat-int.xlsx');
    expect(result.rows[0]?.vatRate).toBeCloseTo(VAT_10_PERCENT_DECIMAL);
  });

  it('0.1(이미 소수)을 그대로 유지', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가', 'VAT'],
      [['샘플', KRW_10000, VAT_10_PERCENT_DECIMAL]],
    );
    const result = await parseQuoteExcel(buffer, 'vat-dec.xlsx');
    expect(result.rows[0]?.vatRate).toBeCloseTo(VAT_10_PERCENT_DECIMAL);
  });

  it('VAT 컬럼이 비어있으면 DEFAULT_VAT_RATE 적용', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [['샘플', KRW_10000]],
    );
    const result = await parseQuoteExcel(buffer, 'vat-default.xlsx');
    expect(result.rows[0]?.vatRate).toBe(DEFAULT_VAT_RATE);
  });

  it('"VAT포함" 컬럼에 Y가 있으면 vatIncluded=true', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가', 'VAT포함'],
      [['샘플', KRW_10000, 'Y']],
    );
    const result = await parseQuoteExcel(buffer, 'vat-inc.xlsx');
    expect(result.rows[0]?.vatIncluded).toBe(true);
  });

  it('VAT포함 컬럼에 "포함"이 있어도 인식', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가', '부가세포함'],
      [['샘플', KRW_10000, '포함']],
    );
    const result = await parseQuoteExcel(buffer, 'vat-inc-kor.xlsx');
    expect(result.rows[0]?.vatIncluded).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// 4. 빈 행 처리 + warnings (P-1)
// ─────────────────────────────────────────────────────────

describe('parseQuoteExcel — 빈 행 및 에러 처리', () => {
  it('완전히 빈 행은 건너뜀', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [
        ['샘플1', KRW_10000],
        ['', ''], // 빈 행 — 스킵
        ['샘플2', KRW_20000],
      ],
    );
    const result = await parseQuoteExcel(buffer, 'empty-row.xlsx');
    const EXPECTED_ROWS = 2;
    expect(result.rows).toHaveLength(EXPECTED_ROWS);
  });

  it('단가가 없는 행은 warnings에 추가 (P-1 — 은폐하지 않음)', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [
        ['정상상품', KRW_10000],
        ['단가없음상품', ''], // 단가 누락
      ],
    );
    const result = await parseQuoteExcel(buffer, 'missing-price.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('단가');
  });

  it('음수 단가는 warnings에 추가', async () => {
    const NEGATIVE = -5000;
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가'],
      [
        ['정상상품', KRW_10000],
        ['음수상품', NEGATIVE],
      ],
    );
    const result = await parseQuoteExcel(buffer, 'negative.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('음수');
  });

  it('소수 MOQ는 warnings에 추가', async () => {
    const FRAC_MOQ = 1.5;
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급단가', 'MOQ'],
      [
        ['정상', KRW_10000, MOQ_100],
        ['소수MOQ', KRW_10000, FRAC_MOQ],
      ],
    );
    const result = await parseQuoteExcel(buffer, 'frac-moq.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('MOQ');
  });
});

// ─────────────────────────────────────────────────────────
// 5. 치명적 에러 — throw
// ─────────────────────────────────────────────────────────

describe('parseQuoteExcel — 치명적 에러', () => {
  it('파일명이 비었으면 throw', async () => {
    const buffer = await buildTestXlsxBuffer(['상품명', '공급단가'], [['a', KRW_10000]]);
    await expect(parseQuoteExcel(buffer, '')).rejects.toThrow('파일명');
  });

  it('빈 워크시트면 throw', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('empty');
    const arr = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arr);

    await expect(parseQuoteExcel(buffer, 'empty.xlsx')).rejects.toThrow('비어있습니다');
  });

  it('단가 컬럼이 없으면 throw (필수 컬럼 누락)', async () => {
    const buffer = await buildTestXlsxBuffer(
      ['상품명', '공급사', '메모'],
      [['샘플', 'A', '비고']],
    );
    await expect(parseQuoteExcel(buffer, 'no-price.xlsx')).rejects.toThrow('단가 컬럼');
  });

  it('xlsx가 아닌 데이터면 throw', async () => {
    const garbage = Buffer.from('not an excel file');
    await expect(parseQuoteExcel(garbage, 'garbage.xlsx')).rejects.toThrow('읽을 수 없습니다');
  });
});

// ─────────────────────────────────────────────────────────
// 타입 가드용 no-op (테스트에서 참조하지 않으면 컴파일러가 에러)
// ─────────────────────────────────────────────────────────
export const _testTypes: TestRow | undefined = undefined;
