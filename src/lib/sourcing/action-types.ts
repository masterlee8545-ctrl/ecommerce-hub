/**
 * 소싱 Server Action 상태 타입 + 초기값 (서버/클라이언트 공용)
 *
 * 출처: src/lib/sourcing/actions.ts (D-2a, F-1c)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화), Next.js 15 'use server' 제약
 *
 * 역할:
 * - 'use server' 파일은 async 함수만 export 할 수 있다
 * - 따라서 useActionState용 상태 타입과 초기값은 별도 파일로 분리
 * - 클라이언트 폼과 서버 액션 양쪽에서 import 가능
 */

// ─────────────────────────────────────────────────────────
// 공급사 (D-2a)
// ─────────────────────────────────────────────────────────

export interface SupplierActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'source' | 'sourceUrl' | 'rating', string>>;
}

export const SUPPLIER_INITIAL_STATE: SupplierActionState = { ok: false };

// ─────────────────────────────────────────────────────────
// 견적 (F-1c)
// ─────────────────────────────────────────────────────────

/**
 * 견적 폼 필드 키 — useActionState fieldErrors 매핑에 사용.
 * createQuoteAction / updateQuoteAction 양쪽 공용.
 */
export type QuoteFieldKey =
  | 'productId'
  | 'supplierId'
  | 'unitPriceKrw'
  | 'unitPriceCny'
  | 'vatRate'
  | 'moq'
  | 'leadTimeDays'
  | 'paymentTerms'
  | 'notes'
  | 'specText';

export interface QuoteActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<QuoteFieldKey, string>>;
}

export const QUOTE_INITIAL_STATE: QuoteActionState = { ok: false };

// ─────────────────────────────────────────────────────────
// 견적 벌크 임포트 (F-2e)
// ─────────────────────────────────────────────────────────

/** 임포트된 한 행의 결과 요약 — UI 표시용 */
export interface QuoteImportRowSummary {
  sourceRow: number;
  status: 'inserted' | 'skipped' | 'unmatched' | 'failed';
  message?: string;
  rawProductCode?: string | null;
  rawProductName?: string | null;
  rawSupplierName?: string | null;
}

export interface QuoteImportActionState {
  ok: boolean;
  error?: string;
  /** 임포트 완료 후 결과 요약 */
  summary?: {
    sourceFileName: string;
    totalRows: number;
    inserted: number;
    skipped: number;
    unmatched: number;
    failed: number;
    detectedColumns: string[];
    rows: QuoteImportRowSummary[];
  };
}

export const QUOTE_IMPORT_INITIAL_STATE: QuoteImportActionState = { ok: false };
