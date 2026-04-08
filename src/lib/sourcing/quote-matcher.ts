/**
 * 견적 임포트 — 상품/공급사 자동 매칭 (F-2c)
 *
 * 출처: F-2 엑셀 벌크 임포트
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 경고 — 매칭 실패 행을 숨기지 않음)
 *
 * 역할:
 * - quote-importer가 파싱한 ParsedQuoteRow의 rawProductCode / rawProductName /
 *   rawSupplierName을 실제 products.id / suppliers.id로 해결
 * - 매칭 실패 행은 버리지 않고 경고와 함께 미매칭 상태로 반환
 *   (사용자가 상품을 추가 등록한 뒤 재임포트할 수 있게)
 *
 * 매칭 우선순위 (상품):
 *   1) rawProductCode가 products.code와 정확히 일치 (대소문자 구분 안 함, 공백 제거)
 *   2) rawProductName이 products.name과 정확히 일치 (공백 정규화)
 *   3) 없음 → productId=null, warning 추가
 *
 * 매칭 우선순위 (공급사):
 *   1) rawSupplierName이 suppliers.name과 정확히 일치 (공백 정규화)
 *   2) 없음 → supplierId=null, warning 추가
 *
 * 멀티테넌트:
 * - listProducts / listSuppliers가 withCompanyContext로 감싸져 RLS 자동 적용
 * - 이 함수는 companyId만 받아서 내부 위임 — 호출자는 ctx를 고민할 필요 없음
 */
import { listProducts } from '@/lib/products/queries';

import { listSuppliers } from './suppliers';

import type { ParsedQuoteRow } from './quote-importer';
import type { BulkQuoteRow } from './quotes';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const MAX_LOOKUP_LIMIT = 500;

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export interface MatchedQuoteRow extends BulkQuoteRow {
  /** 매칭에 실패했을 때 UI에 표시할 원본 값 */
  rawProductCode?: string | null;
  rawProductName?: string | null;
  rawSupplierName?: string | null;
  /** 매칭 실패 이유 (매칭 성공 시 undefined) */
  matchWarning?: string;
}

export interface MatchQuoteRowsParams {
  companyId: string;
  rows: ParsedQuoteRow[];
}

export interface MatchQuoteRowsResult {
  /** product_id + supplier_id 매칭 결과가 채워진 행들 */
  rows: MatchedQuoteRow[];
  /** 매칭 성공 행 수 (productId + supplierId 둘 다 매칭된 행) */
  matchedCount: number;
  /** 매칭 실패 행 수 (productId나 supplierId 중 하나라도 못 찾은 행) */
  unmatchedCount: number;
}

// ─────────────────────────────────────────────────────────
// 문자열 정규화
// ─────────────────────────────────────────────────────────

/** 대소문자 구분 없이 + 양쪽 공백 제거 + 내부 공백 단일화 */
function normalize(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────
// 매칭 본체
// ─────────────────────────────────────────────────────────

/**
 * 파싱된 행들의 상품/공급사 원본 문자열을 실제 id로 해결한다.
 *
 * @throws companyId가 비었거나 rows가 null이면
 */
export async function matchQuoteRows(
  params: MatchQuoteRowsParams,
): Promise<MatchQuoteRowsResult> {
  if (!params.companyId) {
    throw new Error('[matchQuoteRows] companyId가 필요합니다.');
  }
  if (!Array.isArray(params.rows)) {
    throw new Error('[matchQuoteRows] rows가 배열이 아닙니다.');
  }

  if (params.rows.length === 0) {
    return { rows: [], matchedCount: 0, unmatchedCount: 0 };
  }

  // 회사의 상품/공급사 목록을 한 번만 조회 (병렬)
  const [products, suppliers] = await Promise.all([
    listProducts({ companyId: params.companyId, limit: MAX_LOOKUP_LIMIT }),
    listSuppliers({ companyId: params.companyId, limit: MAX_LOOKUP_LIMIT }),
  ]);

  // 룩업 테이블 구성 (정규화된 키 → id)
  const productByCode = new Map<string, string>();
  const productByName = new Map<string, string>();
  for (const p of products) {
    const codeKey = normalize(p.code);
    if (codeKey && !productByCode.has(codeKey)) {
      productByCode.set(codeKey, p.id);
    }
    const nameKey = normalize(p.name);
    if (nameKey && !productByName.has(nameKey)) {
      productByName.set(nameKey, p.id);
    }
  }

  const supplierByName = new Map<string, string>();
  for (const s of suppliers) {
    const nameKey = normalize(s.name);
    if (nameKey && !supplierByName.has(nameKey)) {
      supplierByName.set(nameKey, s.id);
    }
  }

  // 각 행을 순회하며 매칭
  const matched: MatchedQuoteRow[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of params.rows) {
    const resolvedProductId = resolveProductId(row, productByCode, productByName);
    const resolvedSupplierId = resolveSupplierId(row, supplierByName);

    const warnings: string[] = [];
    if (resolvedProductId === null) {
      warnings.push(buildProductWarning(row));
    }
    if (resolvedSupplierId === null && row.rawSupplierName) {
      warnings.push(`공급사 "${row.rawSupplierName}"를 찾을 수 없습니다.`);
    }

    const isMatched = resolvedProductId !== null && resolvedSupplierId !== null;
    if (isMatched) matchedCount += 1;
    else unmatchedCount += 1;

    matched.push({
      sourceRow: row.sourceRow,
      productId: resolvedProductId,
      supplierId: resolvedSupplierId,
      status: row.status ?? 'received',
      unitPriceKrw: row.unitPriceKrw ?? null,
      unitPriceCny: row.unitPriceCny ?? null,
      vatRate: row.vatRate ?? null,
      vatIncluded: row.vatIncluded ?? false,
      moq: row.moq ?? null,
      leadTimeDays: row.leadTimeDays ?? null,
      paymentTerms: row.paymentTerms ?? null,
      notes: row.notes ?? null,
      specText: row.specText ?? null,
      rawProductCode: row.rawProductCode ?? null,
      rawProductName: row.rawProductName ?? null,
      rawSupplierName: row.rawSupplierName ?? null,
      ...(warnings.length > 0 ? { matchWarning: warnings.join(' / ') } : {}),
    });
  }

  return {
    rows: matched,
    matchedCount,
    unmatchedCount,
  };
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

function resolveProductId(
  row: ParsedQuoteRow,
  byCode: Map<string, string>,
  byName: Map<string, string>,
): string | null {
  // 1) 코드 우선
  const codeKey = normalize(row.rawProductCode ?? null);
  if (codeKey) {
    const match = byCode.get(codeKey);
    if (match) return match;
  }
  // 2) 이름 폴백
  const nameKey = normalize(row.rawProductName ?? null);
  if (nameKey) {
    const match = byName.get(nameKey);
    if (match) return match;
  }
  // 3) 이미 productId가 지정되어 있으면 그대로 (수동 지정 케이스)
  if (row.productId) return row.productId;
  return null;
}

function resolveSupplierId(
  row: ParsedQuoteRow,
  bySupplierName: Map<string, string>,
): string | null {
  const nameKey = normalize(row.rawSupplierName ?? null);
  if (nameKey) {
    const match = bySupplierName.get(nameKey);
    if (match) return match;
  }
  // 이미 supplierId가 지정되어 있으면 그대로
  if (row.supplierId) return row.supplierId;
  return null;
}

function buildProductWarning(row: ParsedQuoteRow): string {
  if (row.rawProductCode) {
    return `상품 코드 "${row.rawProductCode}"를 찾을 수 없습니다.`;
  }
  if (row.rawProductName) {
    return `상품명 "${row.rawProductName}"을 찾을 수 없습니다.`;
  }
  return '상품을 식별할 코드/이름이 비어있습니다.';
}
