/**
 * 소싱 Server Actions — 공급사(D-2a) + 견적(F-1c)
 *
 * 출처: src/lib/sourcing/suppliers.ts, src/lib/sourcing/quotes.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어 메시지)
 *
 * 역할:
 * - 폼에서 제출된 FormData를 검증해서 도메인 함수 호출
 * - useActionState용 상태 객체 반환 ({ ok, error?, fieldErrors? })
 * - 성공 시 revalidatePath로 캐시 무효화 + 상세 페이지로 redirect
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - companyId는 폼이 아니라 세션에서 추출 (사용자가 위조 못함)
 *
 * Next.js 15 'use server' 제약:
 * - 이 파일은 async 함수만 export 가능
 * - 상태 타입/초기값은 ./action-types.ts에서 import (export 금지)
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireCompanyContext } from '@/lib/auth/session';

import {
  type QuoteActionState,
  type QuoteFieldKey,
  type QuoteImportActionState,
  type QuoteImportRowSummary,
  type SupplierActionState,
} from './action-types';
import {
  QUOTE_STATUSES,
  SUPPLIER_SOURCES,
  type QuoteStatus,
  type SupplierSource,
} from './constants';
import { parseQuoteExcel } from './quote-importer';
import { matchQuoteRows, type MatchedQuoteRow } from './quote-matcher';
import { acceptQuote, bulkInsertQuotes, createQuote, updateQuote } from './quotes';
import { createSupplier, updateSupplier } from './suppliers';

// ─────────────────────────────────────────────────────────
// 폼 파싱 헬퍼
// ─────────────────────────────────────────────────────────

function getStringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function parseRatingField(form: FormData): number | null {
  const raw = getStringField(form, 'rating').trim();
  if (raw.length === 0) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSourceField(form: FormData): SupplierSource | null {
  const raw = getStringField(form, 'source').trim();
  if (SUPPLIER_SOURCES.includes(raw as SupplierSource)) {
    return raw as SupplierSource;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 공통 검증
// ─────────────────────────────────────────────────────────

function validateForm(form: FormData): {
  ok: true;
  data: {
    name: string;
    source: SupplierSource;
    sourceUrl: string | null;
    contactInfo: string | null;
    rating: number | null;
    notes: string | null;
  };
} | { ok: false; state: SupplierActionState } {
  const name = getStringField(form, 'name').trim();
  const source = parseSourceField(form);
  const sourceUrl = getStringField(form, 'sourceUrl').trim() || null;
  const contactInfo = getStringField(form, 'contactInfo').trim() || null;
  const rating = parseRatingField(form);
  const notes = getStringField(form, 'notes').trim() || null;

  const fieldErrors: NonNullable<SupplierActionState['fieldErrors']> = {};
  if (name.length === 0) fieldErrors.name = '공급사 이름을 입력하세요.';
  if (!source) fieldErrors.source = '공급사 출처를 선택하세요.';
  const MIN_RATING = 1;
  const MAX_RATING = 5;
  if (rating !== null && (rating < MIN_RATING || rating > MAX_RATING)) {
    fieldErrors.rating = `평점은 ${MIN_RATING}~${MAX_RATING} 사이여야 합니다.`;
  }

  if (Object.keys(fieldErrors).length > 0 || !source) {
    return {
      ok: false,
      state: { ok: false, error: '입력값을 확인해주세요.', fieldErrors },
    };
  }

  return {
    ok: true,
    data: { name, source, sourceUrl, contactInfo, rating, notes },
  };
}

// ─────────────────────────────────────────────────────────
// 액션 — 생성
// ─────────────────────────────────────────────────────────

export async function createSupplierAction(
  _prev: SupplierActionState,
  form: FormData,
): Promise<SupplierActionState> {
  const ctx = await requireCompanyContext();

  const validated = validateForm(form);
  if (!validated.ok) return validated.state;

  let createdId: string;
  try {
    const { id } = await createSupplier({
      companyId: ctx.companyId,
      ...validated.data,
    });
    createdId = id;
  } catch (err) {
    console.error('[createSupplierAction] DB 저장 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `저장 중 오류가 발생했습니다: ${err.message}`
          : '저장 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  // 캐시 무효화 + 상세 페이지로
  revalidatePath('/sourcing');
  redirect(`/sourcing/suppliers/${createdId}`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 업데이트
// ─────────────────────────────────────────────────────────

export async function updateSupplierAction(
  supplierId: string,
  _prev: SupplierActionState,
  form: FormData,
): Promise<SupplierActionState> {
  if (!supplierId) {
    return { ok: false, error: '공급사 ID가 없습니다.' };
  }

  const ctx = await requireCompanyContext();

  const validated = validateForm(form);
  if (!validated.ok) return validated.state;

  try {
    await updateSupplier({
      companyId: ctx.companyId,
      supplierId,
      ...validated.data,
    });
  } catch (err) {
    console.error('[updateSupplierAction] DB 수정 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `수정 중 오류가 발생했습니다: ${err.message}`
          : '수정 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  revalidatePath('/sourcing');
  revalidatePath(`/sourcing/suppliers/${supplierId}`);
  redirect(`/sourcing/suppliers/${supplierId}`);
}

// ═════════════════════════════════════════════════════════
// 견적 (F-1c)
// ═════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// 견적 폼 파싱 헬퍼
// ─────────────────────────────────────────────────────────

const PERCENT_DIVISOR = 100;

/** 빈 문자열 → null, 아니면 trimmed string */
function getOptionalStringField(form: FormData, name: string): string | null {
  const raw = getStringField(form, name).trim();
  return raw.length > 0 ? raw : null;
}

/** 숫자 필드 파싱: 빈 값/유효하지 않은 값 → null */
function parseDecimalField(form: FormData, name: string): number | null {
  const raw = getStringField(form, name).trim();
  if (raw.length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 정수 필드 파싱: 빈 값/유효하지 않은 값 → null */
function parseIntegerField(form: FormData, name: string): number | null {
  const raw = getStringField(form, name).trim();
  if (raw.length === 0) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * VAT 비율 입력 파싱.
 * 사용자는 '10' (퍼센트) 형태로 입력 → 0.1로 변환.
 */
function parseVatRateField(form: FormData): number | null {
  const raw = parseDecimalField(form, 'vatRate');
  if (raw === null) return null;
  return raw / PERCENT_DIVISOR;
}

function parseCheckboxField(form: FormData, name: string): boolean {
  const value = form.get(name);
  if (typeof value !== 'string') return false;
  // HTML checkbox는 체크되면 'on' 또는 value="true" 전송
  return value === 'on' || value === 'true' || value === '1';
}

function parseQuoteStatusField(form: FormData): QuoteStatus | null {
  const raw = getStringField(form, 'status').trim();
  if ((QUOTE_STATUSES as readonly string[]).includes(raw)) {
    return raw as QuoteStatus;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 견적 폼 검증 — 생성 / 수정 공용
// ─────────────────────────────────────────────────────────

interface ParsedQuoteFormData {
  productId: string | null;
  supplierId: string | null;
  status: QuoteStatus | null;
  unitPriceKrw: number | null;
  unitPriceCny: number | null;
  vatRate: number | null;
  vatIncluded: boolean;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  notes: string | null;
  specText: string | null;
}

function validateQuoteForm(
  form: FormData,
):
  | { ok: true; data: ParsedQuoteFormData }
  | { ok: false; state: QuoteActionState } {
  const productId = getOptionalStringField(form, 'productId');
  const supplierId = getOptionalStringField(form, 'supplierId');
  const status = parseQuoteStatusField(form);
  const unitPriceKrw = parseDecimalField(form, 'unitPriceKrw');
  const unitPriceCny = parseDecimalField(form, 'unitPriceCny');
  const vatRate = parseVatRateField(form);
  const vatIncluded = parseCheckboxField(form, 'vatIncluded');
  const moq = parseIntegerField(form, 'moq');
  const leadTimeDays = parseIntegerField(form, 'leadTimeDays');
  const paymentTerms = getOptionalStringField(form, 'paymentTerms');
  const notes = getOptionalStringField(form, 'notes');
  const specText = getOptionalStringField(form, 'specText');

  const fieldErrors: Partial<Record<QuoteFieldKey, string>> = {};

  if (!productId) {
    fieldErrors.productId = '상품을 선택하세요.';
  }
  if (!supplierId) {
    fieldErrors.supplierId = '공급사를 선택하세요.';
  }
  if (unitPriceKrw !== null && unitPriceKrw < 0) {
    fieldErrors.unitPriceKrw = '원화 단가는 0 이상이어야 합니다.';
  }
  if (unitPriceCny !== null && unitPriceCny < 0) {
    fieldErrors.unitPriceCny = '위안 단가는 0 이상이어야 합니다.';
  }
  if (vatRate !== null && (vatRate < 0 || vatRate > 1)) {
    fieldErrors.vatRate = '부가세율은 0% ~ 100% 사이여야 합니다.';
  }
  const MIN_MOQ = 1;
  if (moq !== null && moq < MIN_MOQ) {
    fieldErrors.moq = 'MOQ는 1 이상이어야 합니다.';
  }
  if (leadTimeDays !== null && leadTimeDays < 0) {
    fieldErrors.leadTimeDays = '납기 일수는 0 이상이어야 합니다.';
  }

  // 단가가 둘 다 비어있으면 경고 (필수는 아니지만 권장)
  if (unitPriceKrw === null && unitPriceCny === null) {
    fieldErrors.unitPriceKrw = '원화 또는 위안 단가 중 하나는 입력해주세요.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { ok: false, error: '입력값을 확인해주세요.', fieldErrors } };
  }

  return {
    ok: true,
    data: {
      productId,
      supplierId,
      status,
      unitPriceKrw,
      unitPriceCny,
      vatRate,
      vatIncluded,
      moq,
      leadTimeDays,
      paymentTerms,
      notes,
      specText,
    },
  };
}

// ─────────────────────────────────────────────────────────
// 액션 — 견적 생성
// ─────────────────────────────────────────────────────────

export async function createQuoteAction(
  _prev: QuoteActionState,
  form: FormData,
): Promise<QuoteActionState> {
  const ctx = await requireCompanyContext();

  const validated = validateQuoteForm(form);
  if (!validated.ok) return validated.state;

  const { productId, supplierId, status, ...rest } = validated.data;

  let createdProductId: string | null = null;
  try {
    await createQuote({
      companyId: ctx.companyId,
      productId,
      supplierId,
      status: status ?? 'received',
      ...rest,
      createdBy: ctx.userId,
    });
    createdProductId = productId;
  } catch (err) {
    console.error('[createQuoteAction] DB 저장 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `저장 중 오류가 발생했습니다: ${err.message}`
          : '저장 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  // 캐시 무효화
  revalidatePath('/sourcing');
  revalidatePath('/sourcing/quotes');
  if (createdProductId) {
    revalidatePath(`/products/${createdProductId}`);
    redirect(`/products/${createdProductId}`);
  }
  redirect('/sourcing/quotes');
}

// ─────────────────────────────────────────────────────────
// 액션 — 견적 수정
// ─────────────────────────────────────────────────────────

export async function updateQuoteAction(
  quoteId: string,
  _prev: QuoteActionState,
  form: FormData,
): Promise<QuoteActionState> {
  if (!quoteId) {
    return { ok: false, error: '견적 ID가 없습니다.' };
  }

  const ctx = await requireCompanyContext();

  const validated = validateQuoteForm(form);
  if (!validated.ok) return validated.state;

  const { productId, supplierId, status, ...rest } = validated.data;

  try {
    await updateQuote({
      companyId: ctx.companyId,
      quoteId,
      productId,
      supplierId,
      // accepted는 전용 액션 사용 (acceptQuoteAction)
      status: status && status !== 'accepted' ? status : undefined,
      ...rest,
    });
  } catch (err) {
    console.error('[updateQuoteAction] DB 수정 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `수정 중 오류가 발생했습니다: ${err.message}`
          : '수정 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  revalidatePath('/sourcing');
  revalidatePath('/sourcing/quotes');
  if (productId) {
    revalidatePath(`/products/${productId}`);
    redirect(`/products/${productId}`);
  }
  redirect('/sourcing/quotes');
}

// ─────────────────────────────────────────────────────────
// 액션 — 견적 상태 원클릭 전환 (G-3a)
// ─────────────────────────────────────────────────────────

/**
 * 견적 상태를 원클릭으로 전환 (상품 상세 / 견적 목록의 인라인 버튼용).
 *
 * 허용 전환:
 * - requested → received  (공급사로부터 견적서 수신 확인)
 * - requested → rejected  (거절)
 * - received  → rejected  (조건 불일치로 거절)
 *
 * 차단 전환:
 * - accepted로의 전환은 acceptQuoteAction 전용 (다른 견적 자동 거절 + 상품 단계 전환 필요)
 * - accepted 상태에서의 전환은 허용하지 않음 (편집 페이지에서만 처리)
 *
 * updateQuote 내부에서 received 시 received_at, rejected 시 decided_at을 자동 기록함.
 */
export async function updateQuoteStatusAction(form: FormData): Promise<void> {
  const quoteId = getStringField(form, 'quoteId').trim();
  const nextStatus = getStringField(form, 'status').trim();
  const productId = getStringField(form, 'productId').trim();

  if (!quoteId) {
    throw new Error('견적 ID가 없습니다.');
  }
  if (!(QUOTE_STATUSES as readonly string[]).includes(nextStatus)) {
    throw new Error(`유효하지 않은 상태값입니다: ${nextStatus}`);
  }
  if (nextStatus === 'accepted') {
    throw new Error(
      'accepted 상태로의 전환은 "이 견적으로 발주" 버튼(acceptQuoteAction)을 사용하세요.',
    );
  }

  const ctx = await requireCompanyContext();

  try {
    await updateQuote({
      companyId: ctx.companyId,
      quoteId,
      status: nextStatus as QuoteStatus,
    });
  } catch (err) {
    console.error('[updateQuoteStatusAction] DB 변경 실패:', err);
    throw new Error(
      err instanceof Error
        ? `견적 상태 변경 중 오류가 발생했습니다: ${err.message}`
        : '견적 상태 변경 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/sourcing');
  revalidatePath('/sourcing/quotes');
  revalidatePath('/');
  if (productId) {
    revalidatePath(`/products/${productId}`);
  }
}

// ─────────────────────────────────────────────────────────
// 액션 — 견적 확정 (accept)
// ─────────────────────────────────────────────────────────

/**
 * 상품 상세 페이지의 견적 비교표에서 "이 견적으로 발주" 버튼이 호출.
 * 폼 hidden input으로 quoteId, productId를 전달한다.
 *
 * 동작:
 * - acceptQuote 도메인 함수 호출 (같은 상품의 다른 견적 자동 거절, sourcing→importing 전환)
 * - 실패 시 throw → Next.js error.tsx가 사용자 친화 메시지로 표시
 * - 성공 시 /products/[productId]로 리다이렉트 (stage 패널이 importing 상태를 보여줌)
 */
export async function acceptQuoteAction(form: FormData): Promise<void> {
  const quoteId = getStringField(form, 'quoteId').trim();
  const productId = getStringField(form, 'productId').trim();
  const reason = getOptionalStringField(form, 'reason');

  if (!quoteId) {
    throw new Error('견적 ID가 없습니다.');
  }

  const ctx = await requireCompanyContext();

  try {
    await acceptQuote({
      companyId: ctx.companyId,
      quoteId,
      changedBy: ctx.userId,
      reason,
    });
  } catch (err) {
    console.error('[acceptQuoteAction] 견적 확정 실패:', err);
    throw new Error(
      err instanceof Error
        ? `견적 확정 실패: ${err.message}`
        : '견적 확정 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/sourcing');
  revalidatePath('/sourcing/quotes');
  revalidatePath('/products');
  revalidatePath('/tasks'); //                          importing 전환 시 자동 생성된 task 반영
  revalidatePath('/'); //                               대시보드 카운터 갱신
  if (productId) {
    revalidatePath(`/products/${productId}`);
    redirect(`/products/${productId}`);
  }
  redirect('/sourcing/quotes');
}

// ═════════════════════════════════════════════════════════
// 견적 벌크 임포트 (F-2e)
// ═════════════════════════════════════════════════════════

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * BYTES_PER_MB;
const EXCEL_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

/**
 * /sourcing/quotes/import 에서 호출.
 *
 * 흐름:
 * 1. FormData에서 파일 추출 → 크기/MIME 검증
 * 2. 파일 → Buffer 변환
 * 3. parseQuoteExcel로 ParsedQuoteRow[] 얻음
 * 4. matchQuoteRows로 product_id / supplier_id 매칭 (회사 범위)
 * 5. 매칭된 행만 bulkInsertQuotes로 저장 (미매칭 행은 경고에 포함)
 * 6. 결과 요약을 useActionState로 반환 — 페이지는 redirect 없이 결과만 표시
 */
export async function bulkImportQuotesAction(
  _prev: QuoteImportActionState,
  form: FormData,
): Promise<QuoteImportActionState> {
  const ctx = await requireCompanyContext();

  const file = form.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: '업로드된 파일이 없습니다.' };
  }
  if (file.size === 0) {
    return { ok: false, error: '빈 파일입니다.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `파일 크기가 ${MAX_UPLOAD_MB}MB를 초과합니다.` };
  }
  // MIME 타입은 브라우저마다 달라 느슨하게 검사 + 확장자 체크
  const mimeOk = file.type === '' || EXCEL_MIMETYPES.includes(file.type);
  const extOk = /\.xlsx$/i.test(file.name);
  if (!mimeOk && !extOk) {
    return {
      ok: false,
      error: '.xlsx 형식의 엑셀 파일만 지원합니다.',
    };
  }

  // File → Buffer
  let buffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('[bulkImportQuotesAction] 파일 읽기 실패:', err);
    return { ok: false, error: '파일을 읽을 수 없습니다.' };
  }

  // 파싱
  let parsed;
  try {
    parsed = await parseQuoteExcel(buffer, file.name);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : '엑셀 파싱 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  // 매칭
  let matched;
  try {
    matched = await matchQuoteRows({ companyId: ctx.companyId, rows: parsed.rows });
  } catch (err) {
    console.error('[bulkImportQuotesAction] 매칭 실패:', err);
    return {
      ok: false,
      error: '상품/공급사 매칭 중 오류가 발생했습니다.',
    };
  }

  // 매칭 성공 행만 추출 (productId + supplierId 둘 다 있는 것)
  const insertable: MatchedQuoteRow[] = matched.rows.filter(
    (r) => r.productId != null && r.supplierId != null,
  );

  // 실제 저장
  let inserted = 0;
  let dbSkipped = 0;
  if (insertable.length > 0) {
    try {
      const result = await bulkInsertQuotes({
        companyId: ctx.companyId,
        sourceFileName: parsed.sourceFileName,
        rows: insertable,
        createdBy: ctx.userId,
      });
      inserted = result.inserted;
      dbSkipped = result.skipped;
    } catch (err) {
      console.error('[bulkImportQuotesAction] bulk insert 실패:', err);
      return {
        ok: false,
        error:
          err instanceof Error
            ? `저장 중 오류가 발생했습니다: ${err.message}`
            : '저장 중 알 수 없는 오류가 발생했습니다.',
      };
    }
  }

  // 행별 결과 요약 생성
  const rowSummaries: QuoteImportRowSummary[] = [];
  const insertableRowSet = new Set(insertable.map((r) => r.sourceRow));

  // 1) 매칭된 행들
  for (const row of matched.rows) {
    const isInsertable = insertableRowSet.has(row.sourceRow);
    if (isInsertable) {
      rowSummaries.push({
        sourceRow: row.sourceRow,
        status: 'inserted',
        ...(row.rawProductCode !== undefined ? { rawProductCode: row.rawProductCode } : {}),
        ...(row.rawProductName !== undefined ? { rawProductName: row.rawProductName } : {}),
        ...(row.rawSupplierName !== undefined ? { rawSupplierName: row.rawSupplierName } : {}),
      });
    } else {
      rowSummaries.push({
        sourceRow: row.sourceRow,
        status: 'unmatched',
        ...(row.matchWarning ? { message: row.matchWarning } : {}),
        ...(row.rawProductCode !== undefined ? { rawProductCode: row.rawProductCode } : {}),
        ...(row.rawProductName !== undefined ? { rawProductName: row.rawProductName } : {}),
        ...(row.rawSupplierName !== undefined ? { rawSupplierName: row.rawSupplierName } : {}),
      });
    }
  }

  // 2) 파싱 실패(warnings)
  for (const w of parsed.warnings) {
    rowSummaries.push({
      sourceRow: w.sourceRow,
      status: 'failed',
      message: w.message,
    });
  }

  rowSummaries.sort((a, b) => a.sourceRow - b.sourceRow);

  const unmatched = matched.unmatchedCount;
  const failed = parsed.warnings.length;

  // 캐시 무효화
  revalidatePath('/sourcing');
  revalidatePath('/sourcing/quotes');
  revalidatePath('/products'); // 견적이 달린 상품들의 카드 반영

  return {
    ok: true,
    summary: {
      sourceFileName: parsed.sourceFileName,
      totalRows: parsed.rows.length + failed,
      inserted,
      skipped: dbSkipped,
      unmatched,
      failed,
      detectedColumns: parsed.detectedColumns,
      rows: rowSummaries,
    },
  };
}
