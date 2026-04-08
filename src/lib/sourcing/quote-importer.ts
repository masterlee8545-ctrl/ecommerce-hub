/**
 * 견적 엑셀 임포트 — 파서 라이브러리 (F-2b)
 *
 * 출처: F 단계 (국내 수입 대행업체 거래 구조)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-3 (estimated 마킹),
 *       §1 P-9 (사용자 친화 에러 메시지)
 *
 * 역할:
 * - 업로드된 엑셀 파일(Buffer)을 파싱해서 BulkQuoteRow[]로 변환
 * - 컬럼 헤더를 퍼지 매칭으로 찾는다 (한글/영문/공백/대소문자 무시)
 * - 상품 코드나 상품명은 원본 문자열로만 유지 — 실제 product_id 매칭은 quote-matcher.ts가 담당
 *
 * 입력 가정:
 * - 첫 번째 워크시트가 견적 데이터
 * - 첫 행은 헤더 (fuzzy match로 컬럼 인식)
 * - 두 번째 행부터 데이터
 *
 * 지원 컬럼 (퍼지 매칭):
 * - 상품명: '상품명' | '제품명' | '품명' | '상품'
 * - 상품코드: '상품코드' | '코드' | '품번' | 'SKU'
 * - 원화 단가: '원화' | '단가' | '공급단가' | 'KRW' | '원' | '가격'
 * - 위안 단가: '위안' | 'CNY' | '¥' | '원가'
 * - 부가세율: 'VAT' | '부가세' | '부가세율' | '세율'
 * - VAT 포함: 'VAT포함' | '부가세포함' | '포함'
 * - MOQ: 'MOQ' | '최소' | '최소수량' | '최소주문'
 * - 납기: '납기' | '리드타임' | '배송' | '일수'
 * - 결제조건: '결제' | '결제조건' | '지불'
 * - 사양: '사양' | '스펙' | '규격' | '설명'
 * - 메모: '비고' | '메모' | '노트' | '참고'
 *
 * 실패 케이스:
 * - 엑셀 파일이 아님 → throw
 * - 워크시트가 비어있음 → throw
 * - 헤더 행에 단가 컬럼이 전혀 없음 → throw (최소 한 가격 컬럼 필수)
 * - 특정 행의 숫자 파싱 실패 → 해당 행을 warnings에 추가하고 스킵
 */
import ExcelJS from 'exceljs';

import { DEFAULT_VAT_RATE } from './constants';

import type { BulkQuoteRow } from './quotes';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const MAX_ROWS = 1000;
const MAX_STRING_LEN = 2000;
const PERCENT_THRESHOLD = 1.0; // 퍼지 검출: 10% → 0.1 변환 기준
const HEADER_ROW_INDEX = 1;
const FIRST_DATA_ROW_INDEX = 2;

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

/** 퍼지 매칭된 컬럼 인덱스 맵 (1-based). 못 찾은 필드는 undefined. */
interface ColumnMap {
  productName?: number;
  productCode?: number;
  supplierName?: number;
  unitPriceKrw?: number;
  unitPriceCny?: number;
  vatRate?: number;
  vatIncluded?: number;
  moq?: number;
  leadTimeDays?: number;
  paymentTerms?: number;
  specText?: number;
  notes?: number;
}

/** 파싱된 원본 행 — product_id 매칭은 아직 안 됨 */
export interface ParsedQuoteRow extends BulkQuoteRow {
  /** 엑셀에서 읽은 원본 상품명 (매칭에 사용) */
  rawProductName?: string | null;
  /** 엑셀에서 읽은 원본 상품코드 (매칭에 사용) */
  rawProductCode?: string | null;
  /** 엑셀에서 읽은 원본 공급사명 (매칭에 사용) */
  rawSupplierName?: string | null;
}

export interface QuoteExcelParseResult {
  sourceFileName: string;
  rows: ParsedQuoteRow[];
  /** 파싱하지 못한 행의 경고 (어느 행에서 왜 실패했는지) */
  warnings: Array<{ sourceRow: number; message: string }>;
  /** 발견된 컬럼 목록 (사용자 확인용) */
  detectedColumns: string[];
}

// ─────────────────────────────────────────────────────────
// 헤더 퍼지 매칭
// ─────────────────────────────────────────────────────────

/**
 * 헤더 셀 텍스트를 정규화: 소문자 + 공백 제거 + 특수문자 일부 제거.
 */
function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s()[\]{}_\-.:/]/g, '')
    .replace(/[()₩¥$]/g, '');
}

/**
 * 후보 키워드 중 하나라도 포함되면 매칭.
 * 예: normalizeHeader("공급단가(KRW)") → "공급단가krw" → ['단가','krw','원화'] 중 '단가' 포함 → true
 */
function matchesAny(normalized: string, keywords: string[]): boolean {
  return keywords.some((kw) => normalized.includes(kw));
}

/**
 * 헤더 행을 분석해서 컬럼 인덱스 맵 생성.
 * 우선순위: 구체적인 키워드부터 검사. 예) 'vat포함'이 'vat'보다 먼저.
 */
function detectColumns(
  headerRow: ExcelJS.Row,
): { map: ColumnMap; detected: string[] } {
  const map: ColumnMap = {};
  const detected: string[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = String(cell.value ?? '').trim();
    if (raw.length === 0) return;
    const norm = normalizeHeader(raw);

    // 우선순위 순서대로 매칭 — 한 번 매칭되면 break
    if (map.vatIncluded === undefined && matchesAny(norm, ['vat포함', '부가세포함', '포함'])) {
      map.vatIncluded = colNumber;
      detected.push(`VAT포함(${raw})`);
      return;
    }
    if (map.vatRate === undefined && matchesAny(norm, ['vat', '부가세', '세율'])) {
      map.vatRate = colNumber;
      detected.push(`부가세율(${raw})`);
      return;
    }
    if (map.unitPriceCny === undefined && matchesAny(norm, ['위안', 'cny', '元'])) {
      map.unitPriceCny = colNumber;
      detected.push(`위안단가(${raw})`);
      return;
    }
    if (
      map.unitPriceKrw === undefined &&
      matchesAny(norm, ['원화', 'krw', '공급단가', '단가', '가격', '공급가'])
    ) {
      map.unitPriceKrw = colNumber;
      detected.push(`원화단가(${raw})`);
      return;
    }
    if (map.productCode === undefined && matchesAny(norm, ['상품코드', '품번', 'sku', '코드'])) {
      map.productCode = colNumber;
      detected.push(`상품코드(${raw})`);
      return;
    }
    if (
      map.productName === undefined &&
      matchesAny(norm, ['상품명', '제품명', '품명', '상품', '제품'])
    ) {
      map.productName = colNumber;
      detected.push(`상품명(${raw})`);
      return;
    }
    if (
      map.supplierName === undefined &&
      matchesAny(norm, ['공급사', '대행', '업체', '거래처', '공급자'])
    ) {
      map.supplierName = colNumber;
      detected.push(`공급사(${raw})`);
      return;
    }
    if (map.moq === undefined && matchesAny(norm, ['moq', '최소수량', '최소주문', '최소'])) {
      map.moq = colNumber;
      detected.push(`MOQ(${raw})`);
      return;
    }
    if (
      map.leadTimeDays === undefined &&
      matchesAny(norm, ['납기', '리드타임', 'leadtime', '배송일', '제작일', '일수'])
    ) {
      map.leadTimeDays = colNumber;
      detected.push(`납기(${raw})`);
      return;
    }
    if (map.paymentTerms === undefined && matchesAny(norm, ['결제', '지불', 'payment'])) {
      map.paymentTerms = colNumber;
      detected.push(`결제조건(${raw})`);
      return;
    }
    if (map.specText === undefined && matchesAny(norm, ['사양', '스펙', '규격', '설명'])) {
      map.specText = colNumber;
      detected.push(`사양(${raw})`);
      return;
    }
    if (map.notes === undefined && matchesAny(norm, ['비고', '메모', '노트', '참고'])) {
      map.notes = colNumber;
      detected.push(`메모(${raw})`);
      return;
    }
  });

  return { map, detected };
}

// ─────────────────────────────────────────────────────────
// 셀 값 파서
// ─────────────────────────────────────────────────────────

/**
 * ExcelJS 셀 값 → 문자열. null/undefined/빈 문자열은 null.
 * Rich text나 formula result도 처리.
 */
function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // Rich text / hyperlink / formula
  if (typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>;
    if ('richText' in obj && Array.isArray(obj['richText'])) {
      const parts = (obj['richText'] as Array<{ text?: unknown }>)
        .map((rt) => String(rt.text ?? ''))
        .join('')
        .trim();
      return parts.length > 0 ? parts : null;
    }
    if ('text' in obj && typeof obj['text'] === 'string') {
      const t = obj['text'].trim();
      return t.length > 0 ? t : null;
    }
    if ('result' in obj) {
      return cellToString(obj['result'] as ExcelJS.CellValue);
    }
  }
  return null;
}

/**
 * ExcelJS 셀 값 → 숫자. 파싱 실패 시 null.
 * 쉼표(1,000) / 통화 기호(₩/¥/$) / 공백 제거.
 */
function cellToNumber(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object' && value !== null && 'result' in value) {
    return cellToNumber((value as { result: ExcelJS.CellValue }).result);
  }
  const str = cellToString(value);
  if (str === null) return null;
  const cleaned = str.replace(/[₩¥$,\s원元%]/g, '');
  if (cleaned.length === 0) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 엑셀에서 읽은 vat_rate 값을 0~1 범위로 정규화 */
function normalizeVatRate(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return null;
  // 10, 10.0 같은 퍼센트 값으로 왔으면 /100
  if (value > PERCENT_THRESHOLD) return value / 100;
  return value;
}

/** boolean 퍼지 파싱: 'Y','O','포함','TRUE','1','included' → true */
function cellToBoolean(value: ExcelJS.CellValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const str = cellToString(value);
  if (str === null) return false;
  const norm = str.toLowerCase().trim();
  return ['y', 'yes', 'true', '1', 'o', '포함', 'included', '있음'].includes(norm);
}

/** 엑셀에서 읽은 긴 문자열은 잘라서 DB 제약 위반 방지 */
function truncateString(value: string | null, max: number = MAX_STRING_LEN): string | null {
  if (value === null) return null;
  if (value.length <= max) return value;
  return value.slice(0, max);
}

// ─────────────────────────────────────────────────────────
// 파서 본체
// ─────────────────────────────────────────────────────────

/**
 * 엑셀 Buffer → 견적 행 배열.
 * 상품/공급사 매칭은 별도 (quote-matcher.ts 또는 import page)에서 수행.
 *
 * @param buffer    업로드된 파일 내용
 * @param fileName  원본 파일명 (source_file_name에 기록)
 * @throws 엑셀이 아니거나, 워크시트가 비었거나, 필수 컬럼(단가)이 없으면
 */
export async function parseQuoteExcel(
  buffer: Buffer | ArrayBuffer,
  fileName: string,
): Promise<QuoteExcelParseResult> {
  if (!fileName || fileName.trim().length === 0) {
    throw new Error('[parseQuoteExcel] 파일명이 필요합니다.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS는 Buffer를 직접 받는다
    await workbook.xlsx.load(buffer as ArrayBuffer);
  } catch (err) {
    throw new Error(
      `[parseQuoteExcel] 엑셀 파일을 읽을 수 없습니다. .xlsx 형식이 맞는지 확인해주세요. ` +
        `(원인: ${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('[parseQuoteExcel] 엑셀에 워크시트가 없습니다.');
  }
  if (worksheet.rowCount < FIRST_DATA_ROW_INDEX) {
    throw new Error(
      '[parseQuoteExcel] 엑셀이 비어있습니다. 첫 행에 헤더, 두 번째 행부터 데이터가 있어야 합니다.',
    );
  }

  const headerRow = worksheet.getRow(HEADER_ROW_INDEX);
  const { map, detected } = detectColumns(headerRow);

  // 단가 컬럼이 전혀 없으면 의미 있는 데이터가 없는 것
  if (map.unitPriceKrw === undefined && map.unitPriceCny === undefined) {
    throw new Error(
      '[parseQuoteExcel] 단가 컬럼을 찾을 수 없습니다. ' +
        '헤더에 "공급단가", "원화", "KRW", "가격" 등의 이름이 있어야 합니다. ' +
        `(발견된 컬럼: ${detected.length > 0 ? detected.join(', ') : '없음'})`,
    );
  }

  const rows: ParsedQuoteRow[] = [];
  const warnings: Array<{ sourceRow: number; message: string }> = [];

  // 2행부터 데이터 (헤더 제외)
  const lastRow = Math.min(worksheet.rowCount, MAX_ROWS + HEADER_ROW_INDEX);

  for (let rowIdx = FIRST_DATA_ROW_INDEX; rowIdx <= lastRow; rowIdx += 1) {
    const excelRow = worksheet.getRow(rowIdx);

    // 완전히 빈 행은 건너뜀
    if (!excelRow || excelRow.cellCount === 0) continue;
    const allEmpty = isRowEmpty(excelRow, map);
    if (allEmpty) continue;

    try {
      const parsed = parseRow(excelRow, map, rowIdx - HEADER_ROW_INDEX);
      if (parsed) rows.push(parsed);
    } catch (err) {
      warnings.push({
        sourceRow: rowIdx - HEADER_ROW_INDEX,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    sourceFileName: fileName.trim(),
    rows,
    warnings,
    detectedColumns: detected,
  };
}

// ─────────────────────────────────────────────────────────
// 행 파서
// ─────────────────────────────────────────────────────────

/** 매핑된 컬럼에서 모두 빈 값이면 행 스킵 */
function isRowEmpty(row: ExcelJS.Row, map: ColumnMap): boolean {
  const relevantColumns = [
    map.productName,
    map.productCode,
    map.unitPriceKrw,
    map.unitPriceCny,
  ].filter((c): c is number => c !== undefined);

  for (const col of relevantColumns) {
    const val = cellToString(row.getCell(col).value);
    if (val !== null) return false;
  }
  return true;
}

function getCellString(row: ExcelJS.Row, col: number | undefined): string | null {
  if (col === undefined) return null;
  return cellToString(row.getCell(col).value);
}

function getCellNumber(row: ExcelJS.Row, col: number | undefined): number | null {
  if (col === undefined) return null;
  return cellToNumber(row.getCell(col).value);
}

function getCellBoolean(row: ExcelJS.Row, col: number | undefined): boolean | null {
  if (col === undefined) return null;
  return cellToBoolean(row.getCell(col).value);
}

function parseRow(
  row: ExcelJS.Row,
  map: ColumnMap,
  sourceRow: number,
): ParsedQuoteRow | null {
  const rawProductName = getCellString(row, map.productName);
  const rawProductCode = getCellString(row, map.productCode);
  const rawSupplierName = getCellString(row, map.supplierName);

  const unitPriceKrw = getCellNumber(row, map.unitPriceKrw);
  const unitPriceCny = getCellNumber(row, map.unitPriceCny);

  // 적어도 하나의 단가는 필요
  if (unitPriceKrw === null && unitPriceCny === null) {
    throw new Error('단가(원화/위안)가 비어있거나 숫자로 읽을 수 없습니다.');
  }
  if (unitPriceKrw !== null && unitPriceKrw < 0) {
    throw new Error(`원화 단가가 음수입니다: ${unitPriceKrw}`);
  }
  if (unitPriceCny !== null && unitPriceCny < 0) {
    throw new Error(`위안 단가가 음수입니다: ${unitPriceCny}`);
  }

  const vatRateRaw = getCellNumber(row, map.vatRate);
  const vatRate = normalizeVatRate(vatRateRaw) ?? DEFAULT_VAT_RATE;
  const vatIncluded = getCellBoolean(row, map.vatIncluded) ?? false;

  const moq = getCellNumber(row, map.moq);
  if (moq !== null && (!Number.isInteger(moq) || moq <= 0)) {
    throw new Error(`MOQ는 양의 정수여야 합니다: ${moq}`);
  }

  const leadTimeDays = getCellNumber(row, map.leadTimeDays);
  if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) {
    throw new Error(`납기 일수는 0 이상의 정수여야 합니다: ${leadTimeDays}`);
  }

  const paymentTerms = truncateString(getCellString(row, map.paymentTerms));
  const specText = truncateString(getCellString(row, map.specText));
  const notes = truncateString(getCellString(row, map.notes));

  return {
    sourceRow,
    rawProductName,
    rawProductCode,
    rawSupplierName,
    // productId / supplierId 는 매칭 단계에서 채워짐
    productId: null,
    supplierId: null,
    status: 'received',
    unitPriceKrw,
    unitPriceCny,
    vatRate,
    vatIncluded,
    moq,
    leadTimeDays,
    paymentTerms,
    notes,
    specText,
  };
}
