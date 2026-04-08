/**
 * 견적(quotes) 도메인 — 쿼리 + 변경 헬퍼
 *
 * 출처: src/db/schema/quotes.ts (F-1b KRW/VAT 확장), docs/DATA_MODEL.md §3.6
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 throw),
 *       §1 P-3 (estimated 강제), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 에러)
 *
 * 역할:
 * - 상품별 견적 목록 (비교표용)
 * - 견적 단건 조회 / 생성 / 수정
 * - 견적 확정 (accept) — 같은 상품의 다른 견적을 자동 거절 + 상품 단계 전환(sourcing → importing)
 * - 벌크 삽입 (F-2 엑셀 임포트에서 호출)
 *
 * 단가 정책 (F 단계 — 국내 수입 대행업체 거래):
 * - unit_price_krw가 주력 (원화)
 * - vat_included=false가 기본 (단가 + VAT 10% 별도)
 * - unit_price_cny는 직거래 대비로만 유지
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS 자동 적용.
 */
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { products, quotes, suppliers, type NewQuote, type Quote } from '@/db/schema';
import { transitionProductStatus } from '@/lib/products/transitions';

import {
  DEFAULT_VAT_RATE,
  OPEN_QUOTE_STATUSES,
  QUOTE_STATUSES,
  type QuoteStatus,
} from './constants';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const MAX_NOTES_LEN = 2000;
const MAX_SPEC_LEN = 2000;
const MAX_PAYMENT_TERMS_LEN = 500;
const MAX_FILE_NAME_LEN = 255;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;
const MAX_BULK_INSERT = 500;
const QUOTE_ID_PREVIEW_LEN = 8;

// ─────────────────────────────────────────────────────────
// 입력 / 출력 타입
// ─────────────────────────────────────────────────────────

export interface ListQuotesForProductParams {
  companyId: string;
  productId: string;
  /** 특정 상태만. 빈 배열 / undefined면 전체. */
  statuses?: QuoteStatus[] | undefined;
  limit?: number | undefined;
}

export interface ListQuotesParams {
  companyId: string;
  statuses?: QuoteStatus[] | undefined;
  supplierId?: string | undefined;
  limit?: number | undefined;
}

export interface CreateQuoteInput {
  companyId: string;
  productId?: string | null | undefined;
  supplierId?: string | null | undefined;
  status?: QuoteStatus | undefined;
  /** 공급단가 (원화) — 사장님 주력 컬럼 */
  unitPriceKrw?: number | null | undefined;
  /** 공급단가 (위안) — 대비용 */
  unitPriceCny?: number | null | undefined;
  /** 부가세율 (0~1). 미지정 시 기본값 10%. */
  vatRate?: number | null | undefined;
  /** 단가에 VAT 포함 여부. 미지정 시 false(별도). */
  vatIncluded?: boolean | undefined;
  moq?: number | null | undefined;
  leadTimeDays?: number | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  specText?: string | null | undefined;
  /** F-2 벌크 임포트 추적용 */
  sourceFileName?: string | null | undefined;
  sourceRow?: number | null | undefined;
  createdBy?: string | null | undefined;
}

export interface UpdateQuoteInput {
  companyId: string;
  quoteId: string;
  productId?: string | null | undefined;
  supplierId?: string | null | undefined;
  status?: QuoteStatus | undefined;
  unitPriceKrw?: number | null | undefined;
  unitPriceCny?: number | null | undefined;
  vatRate?: number | null | undefined;
  vatIncluded?: boolean | undefined;
  moq?: number | null | undefined;
  leadTimeDays?: number | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  specText?: string | null | undefined;
}

export interface AcceptQuoteInput {
  companyId: string;
  quoteId: string;
  /** 누가 확정했는지 (NextAuth user.id, 선택) */
  changedBy?: string | null | undefined;
  /** 사용자 사유 메모 (선택, 500자 제한) */
  reason?: string | null | undefined;
}

export interface AcceptQuoteResult {
  acceptedQuoteId: string;
  /** 함께 거절된 다른 견적 id들 */
  rejectedQuoteIds: string[];
  /** 상품 단계가 실제로 전환됐는지 (sourcing → importing). 이미 importing 이상이면 false. */
  productTransitioned: boolean;
  /** 자동 생성된 task 수 */
  tasksCreated: number;
}

/** F-2 엑셀 임포트에서 사용하는 단일 행 명세 */
export interface BulkQuoteRow {
  productId?: string | null | undefined;
  supplierId?: string | null | undefined;
  status?: QuoteStatus | undefined;
  unitPriceKrw?: number | null | undefined;
  unitPriceCny?: number | null | undefined;
  vatRate?: number | null | undefined;
  vatIncluded?: boolean | undefined;
  moq?: number | null | undefined;
  leadTimeDays?: number | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  specText?: string | null | undefined;
  sourceRow: number;
}

export interface BulkInsertQuotesInput {
  companyId: string;
  sourceFileName: string;
  rows: BulkQuoteRow[];
  createdBy?: string | null | undefined;
}

export interface BulkInsertQuotesResult {
  inserted: number;
  skipped: number;
  sourceFileName: string;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function validateStatus(status: string | undefined): asserts status is QuoteStatus | undefined {
  if (status === undefined) return;
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(
      `[quotes] 상태값이 유효하지 않습니다: ${status}. 허용값: ${QUOTE_STATUSES.join(', ')}`,
    );
  }
}

function validateUnitPrice(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`[quotes] ${field}는 0 이상이어야 합니다. 받은 값: ${value}`);
  }
}

function validateVatRate(value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `[quotes] 부가세율(vat_rate)은 0~1 사이여야 합니다 (예: 0.1 = 10%). 받은 값: ${value}`,
    );
  }
}

function validateMoq(value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[quotes] MOQ는 양의 정수여야 합니다. 받은 값: ${value}`);
  }
}

function validateLeadTime(value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[quotes] lead_time_days는 0 이상의 정수여야 합니다. 받은 값: ${value}`);
  }
}

function validateMaxLen(
  value: string | null | undefined,
  max: number,
  field: string,
): void {
  if (value === null || value === undefined) return;
  if (value.length > max) {
    throw new Error(`[quotes] ${field}가 너무 깁니다 (최대 ${max}자).`);
  }
}

/**
 * 숫자를 Drizzle decimal 컬럼용 문자열로 변환.
 * null/undefined는 그대로 null 반환.
 */
function toDecimalString(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// ─────────────────────────────────────────────────────────
// URL 쿼리 파서
// ─────────────────────────────────────────────────────────

/**
 * URL 검색 파라미터에서 status 필터 파싱.
 * 예: ?status=received,requested → ['received','requested']
 * 잘못된 값은 조용히 무시 (빈 배열 반환 시 전체 조회).
 */
export function parseQuoteStatusFilter(raw: string | null | undefined): QuoteStatus[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is QuoteStatus => (QUOTE_STATUSES as readonly string[]).includes(s));
}

// ─────────────────────────────────────────────────────────
// 조회 — 상품별 견적 목록 (비교표)
// ─────────────────────────────────────────────────────────

/**
 * 특정 상품의 견적 목록을 가져온다 (최신순).
 * 상품 상세 페이지의 견적 비교표에서 사용.
 */
export async function listQuotesForProduct(
  params: ListQuotesForProductParams,
): Promise<Quote[]> {
  if (!params.companyId) {
    throw new Error('[listQuotesForProduct] companyId가 필요합니다.');
  }
  if (!params.productId) {
    throw new Error('[listQuotesForProduct] productId가 필요합니다.');
  }

  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [
      eq(quotes.company_id, params.companyId),
      eq(quotes.product_id, params.productId),
    ];
    if (params.statuses && params.statuses.length > 0) {
      conditions.push(inArray(quotes.status, params.statuses));
    }

    const rows = await tx
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.requested_at))
      .limit(limit);
    return rows;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 회사 전체 견적 목록
// ─────────────────────────────────────────────────────────

/**
 * 회사의 모든 견적 목록 (필터 가능, 최신순).
 * /sourcing/quotes 같은 전체 목록 페이지에서 사용.
 */
export async function listQuotes(params: ListQuotesParams): Promise<Quote[]> {
  if (!params.companyId) {
    throw new Error('[listQuotes] companyId가 필요합니다.');
  }

  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [eq(quotes.company_id, params.companyId)];
    if (params.statuses && params.statuses.length > 0) {
      conditions.push(inArray(quotes.status, params.statuses));
    }
    if (params.supplierId) {
      conditions.push(eq(quotes.supplier_id, params.supplierId));
    }

    const rows = await tx
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.requested_at))
      .limit(limit);
    return rows;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 전체 목록 (상품/공급사 조인)
// ─────────────────────────────────────────────────────────

/**
 * 한 행의 견적 + 연관된 상품/공급사 최소 정보.
 * `/sourcing/quotes` 목록 페이지에서 사용.
 */
export interface QuoteWithRelations {
  quote: Quote;
  product: {
    id: string;
    code: string;
    name: string;
  } | null;
  supplier: {
    id: string;
    name: string;
  } | null;
}

/**
 * 회사 전체 견적 목록 + 상품/공급사 정보.
 *
 * 구현:
 * 1. listQuotes로 견적 조회 (필터 포함)
 * 2. 결과에서 유니크한 product_id / supplier_id 수집
 * 3. 별도 쿼리로 조회 후 룩업 Map 구성
 * 4. 각 견적에 product/supplier 첨부
 *
 * 왜 join이 아닌 multi-query?
 * - 기존 코드베이스 전체가 withCompanyContext 안에서 단일 table select만 사용
 * - 각 도메인의 RLS 제약과 검증 로직이 별도 함수에 캡슐화돼 있음
 * - quote-matcher.ts와 동일한 패턴 — 작은 N(≤200)에서는 성능 차이 무시 가능
 */
export async function listQuotesWithRelations(
  params: ListQuotesParams,
): Promise<QuoteWithRelations[]> {
  const quoteRows = await listQuotes(params);
  if (quoteRows.length === 0) return [];

  const productIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const q of quoteRows) {
    if (q.product_id) productIds.add(q.product_id);
    if (q.supplier_id) supplierIds.add(q.supplier_id);
  }

  return withCompanyContext(params.companyId, async (tx) => {
    // 상품/공급사 병렬 조회
    const [productRows, supplierRows] = await Promise.all([
      productIds.size > 0
        ? tx
            .select({
              id: products.id,
              code: products.code,
              name: products.name,
            })
            .from(products)
            .where(
              and(
                eq(products.company_id, params.companyId),
                inArray(products.id, Array.from(productIds)),
              ),
            )
        : Promise.resolve<Array<{ id: string; code: string; name: string }>>([]),
      supplierIds.size > 0
        ? tx
            .select({
              id: suppliers.id,
              name: suppliers.name,
            })
            .from(suppliers)
            .where(
              and(
                eq(suppliers.company_id, params.companyId),
                inArray(suppliers.id, Array.from(supplierIds)),
              ),
            )
        : Promise.resolve<Array<{ id: string; name: string }>>([]),
    ]);

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const supplierMap = new Map(supplierRows.map((s) => [s.id, s]));

    return quoteRows.map<QuoteWithRelations>((q) => ({
      quote: q,
      product: q.product_id ? productMap.get(q.product_id) ?? null : null,
      supplier: q.supplier_id ? supplierMap.get(q.supplier_id) ?? null : null,
    }));
  });
}

/**
 * 회사의 견적 상태별 카운트 (필터 칩용).
 */
export async function countQuotesByStatus(
  companyId: string,
): Promise<Record<QuoteStatus, number>> {
  if (!companyId) {
    throw new Error('[countQuotesByStatus] companyId가 필요합니다.');
  }

  const initial: Record<QuoteStatus, number> = {
    requested: 0,
    received: 0,
    accepted: 0,
    rejected: 0,
  };

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ status: quotes.status, n: count() })
      .from(quotes)
      .where(eq(quotes.company_id, companyId))
      .groupBy(quotes.status);

    for (const row of rows) {
      if ((QUOTE_STATUSES as readonly string[]).includes(row.status)) {
        initial[row.status as QuoteStatus] = Number(row.n);
      }
    }
    return initial;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 단건
// ─────────────────────────────────────────────────────────

export async function getQuoteById(
  companyId: string,
  quoteId: string,
): Promise<Quote | null> {
  if (!companyId || !quoteId) {
    throw new Error('[getQuoteById] companyId와 quoteId가 필요합니다.');
  }
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    return rows[0] ?? null;
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 생성
// ─────────────────────────────────────────────────────────

/**
 * 견적 생성 (단건 수동 입력 또는 API).
 * - 기본 status는 'received' (이미 받은 견적을 수동 등록하는 흐름)
 * - unit_price_krw 또는 unit_price_cny 중 하나 이상은 권장 (검증 안 함 — 의뢰중 견적도 허용)
 */
export async function createQuote(input: CreateQuoteInput): Promise<{ id: string }> {
  if (!input.companyId) {
    throw new Error('[createQuote] companyId가 필요합니다.');
  }

  validateStatus(input.status);
  validateUnitPrice(input.unitPriceKrw, 'unit_price_krw');
  validateUnitPrice(input.unitPriceCny, 'unit_price_cny');
  validateVatRate(input.vatRate);
  validateMoq(input.moq);
  validateLeadTime(input.leadTimeDays);
  validateMaxLen(input.paymentTerms, MAX_PAYMENT_TERMS_LEN, 'payment_terms');
  validateMaxLen(input.notes, MAX_NOTES_LEN, 'notes');
  validateMaxLen(input.specText, MAX_SPEC_LEN, 'spec_text');
  validateMaxLen(input.sourceFileName, MAX_FILE_NAME_LEN, 'source_file_name');

  const now = new Date();
  const status = input.status ?? 'received';
  const vatRate = input.vatRate ?? DEFAULT_VAT_RATE;

  const values: NewQuote = {
    company_id: input.companyId,
    product_id: input.productId ?? null,
    supplier_id: input.supplierId ?? null,
    status,
    unit_price_krw: toDecimalString(input.unitPriceKrw),
    unit_price_cny: toDecimalString(input.unitPriceCny),
    vat_rate: toDecimalString(vatRate),
    vat_included: input.vatIncluded ?? false,
    moq: input.moq ?? null,
    lead_time_days: input.leadTimeDays ?? null,
    payment_terms: input.paymentTerms?.trim() || null,
    notes: input.notes?.trim() || null,
    spec_text: input.specText?.trim() || null,
    source_file_name: input.sourceFileName?.trim() || null,
    source_row: input.sourceRow ?? null,
    requested_at: now,
    received_at: status === 'requested' ? null : now,
    created_by: input.createdBy ?? null,
  };

  return withCompanyContext(input.companyId, async (tx) => {
    const inserted = await tx.insert(quotes).values(values).returning({ id: quotes.id });
    const row = inserted[0];
    if (!row) {
      throw new Error('[createQuote] INSERT가 행을 반환하지 않았습니다.');
    }
    return { id: row.id };
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 업데이트 (부분 수정)
// ─────────────────────────────────────────────────────────

/**
 * 견적 부분 수정. status 변경도 여기서 가능 (단, accepted로는 acceptQuote를 써야 함).
 */
export async function updateQuote(input: UpdateQuoteInput): Promise<void> {
  if (!input.companyId || !input.quoteId) {
    throw new Error('[updateQuote] companyId와 quoteId가 필요합니다.');
  }

  validateStatus(input.status);
  // accepted로의 전환은 acceptQuote 전용 (다른 견적 자동 거절 + 제품 전환 필요)
  if (input.status === 'accepted') {
    throw new Error(
      '[updateQuote] accepted 상태로의 전환은 updateQuote가 아닌 acceptQuote를 사용하세요.',
    );
  }
  if (input.unitPriceKrw !== undefined) validateUnitPrice(input.unitPriceKrw, 'unit_price_krw');
  if (input.unitPriceCny !== undefined) validateUnitPrice(input.unitPriceCny, 'unit_price_cny');
  if (input.vatRate !== undefined) validateVatRate(input.vatRate);
  if (input.moq !== undefined) validateMoq(input.moq);
  if (input.leadTimeDays !== undefined) validateLeadTime(input.leadTimeDays);
  if (input.paymentTerms !== undefined) {
    validateMaxLen(input.paymentTerms, MAX_PAYMENT_TERMS_LEN, 'payment_terms');
  }
  if (input.notes !== undefined) validateMaxLen(input.notes, MAX_NOTES_LEN, 'notes');
  if (input.specText !== undefined) validateMaxLen(input.specText, MAX_SPEC_LEN, 'spec_text');

  const patch: Partial<NewQuote> = {};

  if (input.productId !== undefined) patch.product_id = input.productId;
  if (input.supplierId !== undefined) patch.supplier_id = input.supplierId;
  if (input.status !== undefined) {
    patch.status = input.status;
    // received로 전환되는 순간 received_at 기록
    if (input.status === 'received') patch.received_at = new Date();
    if (input.status === 'rejected') patch.decided_at = new Date();
  }
  if (input.unitPriceKrw !== undefined) patch.unit_price_krw = toDecimalString(input.unitPriceKrw);
  if (input.unitPriceCny !== undefined) patch.unit_price_cny = toDecimalString(input.unitPriceCny);
  if (input.vatRate !== undefined) patch.vat_rate = toDecimalString(input.vatRate);
  if (input.vatIncluded !== undefined) patch.vat_included = input.vatIncluded;
  if (input.moq !== undefined) patch.moq = input.moq;
  if (input.leadTimeDays !== undefined) patch.lead_time_days = input.leadTimeDays;
  if (input.paymentTerms !== undefined) patch.payment_terms = input.paymentTerms?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.specText !== undefined) patch.spec_text = input.specText?.trim() || null;

  if (Object.keys(patch).length === 0) return;

  await withCompanyContext(input.companyId, async (tx) => {
    await tx
      .update(quotes)
      .set(patch)
      .where(and(eq(quotes.id, input.quoteId), eq(quotes.company_id, input.companyId)));
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 확정 (accept)
// ─────────────────────────────────────────────────────────

/**
 * 견적을 확정(accept)한다.
 *
 * 동작:
 * 1. 트랜잭션 #1 (quotes):
 *    - 대상 견적을 SELECT → product_id 확인, 이미 accepted/rejected면 throw
 *    - 대상 견적 UPDATE: status='accepted', decided_at=now
 *    - 같은 상품의 다른 OPEN_QUOTE_STATUSES 견적들 UPDATE: status='rejected', decided_at=now
 * 2. 트랜잭션 #2 (products, 조건부):
 *    - 상품 status가 'sourcing'이면 transitionProductStatus(→ importing) 호출
 *    - 자동 task 생성 포함 (TRANSITION_TASK_MAP)
 *    - 이미 importing 이상이면 skip
 *
 * 원자성 주의:
 * - 1, 2는 별개 트랜잭션이다. #2가 실패해도 #1은 커밋됨.
 * - 이유: transitionProductStatus가 자체 withCompanyContext를 사용하므로 합치기 어려움.
 * - 실제 실패는 매우 드물고, 실패 시 /products/[id] 페이지에서 수동 진행 가능.
 *
 * @returns 확정 결과 + 자동 거절된 견적 id 목록 + 제품 전환 여부
 */
export async function acceptQuote(input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
  if (!input.companyId || !input.quoteId) {
    throw new Error('[acceptQuote] companyId와 quoteId가 필요합니다.');
  }

  // ─── 트랜잭션 #1: 견적 확정 + 다른 견적 거절 ───
  const stageOne = await withCompanyContext(input.companyId, async (tx) => {
    const rows = await tx
      .select({
        id: quotes.id,
        product_id: quotes.product_id,
        status: quotes.status,
      })
      .from(quotes)
      .where(and(eq(quotes.id, input.quoteId), eq(quotes.company_id, input.companyId)))
      .limit(1);

    const target = rows[0];
    if (!target) {
      throw new Error(
        `[acceptQuote] 견적을 찾을 수 없습니다: ${input.quoteId} ` +
          `(다른 회사 소속이거나 삭제되었을 수 있습니다)`,
      );
    }

    if (target.status === 'accepted') {
      throw new Error('[acceptQuote] 이 견적은 이미 확정된 상태입니다.');
    }
    if (target.status === 'rejected') {
      throw new Error('[acceptQuote] 거절된 견적은 다시 확정할 수 없습니다.');
    }
    if (!target.product_id) {
      throw new Error(
        '[acceptQuote] 상품이 연결되지 않은 견적은 확정할 수 없습니다. 먼저 상품을 지정하세요.',
      );
    }

    const now = new Date();
    const productId: string = target.product_id;

    // 1) 대상 견적 확정
    await tx
      .update(quotes)
      .set({ status: 'accepted', decided_at: now })
      .where(eq(quotes.id, target.id));

    // 2) 같은 상품의 다른 열린 견적을 자동 거절
    const otherOpen = await tx
      .select({ id: quotes.id })
      .from(quotes)
      .where(
        and(
          eq(quotes.company_id, input.companyId),
          eq(quotes.product_id, productId),
          inArray(quotes.status, OPEN_QUOTE_STATUSES),
        ),
      );

    const otherIds = otherOpen.map((r) => r.id).filter((id) => id !== target.id);

    if (otherIds.length > 0) {
      await tx
        .update(quotes)
        .set({ status: 'rejected', decided_at: now })
        .where(inArray(quotes.id, otherIds));
    }

    // 3) 상품 현재 status 확인 (트랜잭션 #2에서 필요)
    const productRows = await tx
      .select({ status: products.status })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.company_id, input.companyId)))
      .limit(1);

    const productStatus = productRows[0]?.status ?? null;

    return {
      productId,
      productStatus,
      rejectedQuoteIds: otherIds,
    };
  });

  // ─── 트랜잭션 #2: 상품 단계 전환 (조건부) ───
  let productTransitioned = false;
  let tasksCreated = 0;

  if (stageOne.productStatus === 'sourcing') {
    try {
      const transitionResult = await transitionProductStatus({
        companyId: input.companyId,
        productId: stageOne.productId,
        toStatus: 'importing',
        changedBy: input.changedBy ?? null,
        reason:
          input.reason?.trim() ||
          `견적 확정 (${input.quoteId.slice(0, QUOTE_ID_PREVIEW_LEN)})`,
      });
      productTransitioned = true;
      tasksCreated = transitionResult.tasksCreated;
    } catch (err) {
      // 견적은 이미 확정됐으므로, 제품 전환 실패는 로그만 남기고 사용자에게 부분 성공 알림
      console.error('[acceptQuote] 상품 단계 전환 실패 (수동 진행 필요):', err);
    }
  }

  return {
    acceptedQuoteId: input.quoteId,
    rejectedQuoteIds: stageOne.rejectedQuoteIds,
    productTransitioned,
    tasksCreated,
  };
}

// ─────────────────────────────────────────────────────────
// 변경 — 벌크 삽입 (F-2 엑셀 임포트)
// ─────────────────────────────────────────────────────────

/**
 * 여러 견적을 한 번에 삽입. F-2 엑셀 임포트에서 호출된다.
 *
 * - 전체가 한 트랜잭션 안에서 실행 — 하나가 실패하면 전체 롤백.
 * - 검증 실패는 명시적 에러 (어느 행인지 알려준다).
 * - 중복 방지: 같은 (company_id, source_file_name, source_row)가 이미 있으면 skip.
 * - status 미지정 시 'received' (엑셀은 보통 이미 받은 견적을 일괄 등록).
 *
 * @throws 입력이 비어있거나 MAX_BULK_INSERT 초과 시
 */
export async function bulkInsertQuotes(
  input: BulkInsertQuotesInput,
): Promise<BulkInsertQuotesResult> {
  if (!input.companyId) {
    throw new Error('[bulkInsertQuotes] companyId가 필요합니다.');
  }
  if (!input.sourceFileName || input.sourceFileName.trim().length === 0) {
    throw new Error('[bulkInsertQuotes] sourceFileName이 필요합니다.');
  }
  validateMaxLen(input.sourceFileName, MAX_FILE_NAME_LEN, 'source_file_name');

  if (!input.rows || input.rows.length === 0) {
    throw new Error('[bulkInsertQuotes] 삽입할 행이 없습니다.');
  }
  if (input.rows.length > MAX_BULK_INSERT) {
    throw new Error(
      `[bulkInsertQuotes] 한 번에 ${MAX_BULK_INSERT}개를 초과할 수 없습니다 (받은 행: ${input.rows.length}).`,
    );
  }

  // 각 행 사전 검증 — 실패 시 어느 행인지 포함한 에러
  for (const row of input.rows) {
    try {
      validateStatus(row.status);
      validateUnitPrice(row.unitPriceKrw, 'unit_price_krw');
      validateUnitPrice(row.unitPriceCny, 'unit_price_cny');
      validateVatRate(row.vatRate);
      validateMoq(row.moq);
      validateLeadTime(row.leadTimeDays);
      validateMaxLen(row.paymentTerms, MAX_PAYMENT_TERMS_LEN, 'payment_terms');
      validateMaxLen(row.notes, MAX_NOTES_LEN, 'notes');
      validateMaxLen(row.specText, MAX_SPEC_LEN, 'spec_text');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[bulkInsertQuotes] ${input.sourceFileName} 행 ${row.sourceRow}: ${msg}`);
    }
  }

  const fileName = input.sourceFileName.trim();
  const now = new Date();

  return withCompanyContext(input.companyId, async (tx) => {
    // 같은 파일명으로 이미 임포트된 (source_row) 목록 조회 → dedup
    const existing = await tx
      .select({ sourceRow: quotes.source_row })
      .from(quotes)
      .where(
        and(
          eq(quotes.company_id, input.companyId),
          eq(quotes.source_file_name, fileName),
          isNotNull(quotes.source_row),
        ),
      );
    const existingRows = new Set(
      existing
        .map((r) => r.sourceRow)
        .filter((r): r is number => r !== null && r !== undefined),
    );

    const toInsert: NewQuote[] = [];
    let skipped = 0;

    for (const row of input.rows) {
      if (existingRows.has(row.sourceRow)) {
        skipped += 1;
        continue;
      }
      const status = row.status ?? 'received';
      const vatRate = row.vatRate ?? DEFAULT_VAT_RATE;

      toInsert.push({
        company_id: input.companyId,
        product_id: row.productId ?? null,
        supplier_id: row.supplierId ?? null,
        status,
        unit_price_krw: toDecimalString(row.unitPriceKrw),
        unit_price_cny: toDecimalString(row.unitPriceCny),
        vat_rate: toDecimalString(vatRate),
        vat_included: row.vatIncluded ?? false,
        moq: row.moq ?? null,
        lead_time_days: row.leadTimeDays ?? null,
        payment_terms: row.paymentTerms?.trim() || null,
        notes: row.notes?.trim() || null,
        spec_text: row.specText?.trim() || null,
        source_file_name: fileName,
        source_row: row.sourceRow,
        requested_at: now,
        received_at: status === 'requested' ? null : now,
        created_by: input.createdBy ?? null,
      });
    }

    if (toInsert.length > 0) {
      await tx.insert(quotes).values(toInsert);
    }

    return {
      inserted: toInsert.length,
      skipped,
      sourceFileName: fileName,
    };
  });
}
