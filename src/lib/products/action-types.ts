/**
 * 상품 Server Action 상태 타입 + 초기값 (서버/클라이언트 공용)
 *
 * 출처: src/lib/products/actions.ts (E-1b)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화), Next.js 15 'use server' 제약
 *
 * 역할:
 * - 'use server' 파일은 async 함수만 export 할 수 있다
 * - useActionState용 상태 타입과 초기값을 별도 파일로 분리
 * - 클라이언트 폼(use client)과 서버 액션 양쪽에서 import 가능
 */

// ─────────────────────────────────────────────────────────
// 상품 생성/수정 폼 상태
// ─────────────────────────────────────────────────────────

/** 상품 폼에서 표시할 수 있는 필드별 에러 키 */
export type ProductFieldKey =
  | 'code'
  | 'name'
  | 'category'
  | 'cogsCny'
  | 'cogsCnyConfidence'
  | 'sellingPriceKrw'
  | 'marginRate'
  | 'marginRateConfidence'
  | 'description';

export interface ProductActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<ProductFieldKey, string>>;
}

export const PRODUCT_INITIAL_STATE: ProductActionState = { ok: false };
