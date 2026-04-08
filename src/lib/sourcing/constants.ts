/**
 * 소싱 도메인 관련 상수 + 타입 (서버/클라이언트 공용)
 *
 * 출처: src/lib/sourcing/suppliers.ts (D-2a), src/lib/sourcing/quotes.ts (F-1a)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 'use client' 컴포넌트가 직접 import 해도 안전한 순수 상수만 모음
 * - suppliers.ts / quotes.ts는 @/db (postgres)를 import 하므로 클라이언트에서 못 쓴다
 * - 폼 컴포넌트는 여기서 SUPPLIER_SOURCES / QUOTE_STATUSES 등을 가져온다
 */

// ─────────────────────────────────────────────────────────
// 공급사
// ─────────────────────────────────────────────────────────

export const SUPPLIER_SOURCES = ['1688', 'taobao', 'domestic', 'other'] as const;
export type SupplierSource = (typeof SUPPLIER_SOURCES)[number];

// ─────────────────────────────────────────────────────────
// 견적 (F-1a)
// ─────────────────────────────────────────────────────────

/**
 * 견적 라이프사이클.
 * - requested: 견적 의뢰 (아직 답변 없음)
 * - received:  공급사가 답변 — 단가/MOQ/납기 정보 있음
 * - accepted:  이 견적으로 발주 확정 (상품 단계 sourcing → importing 전환 시점)
 * - rejected:  거절됨 (다른 견적을 선택하거나 포기)
 */
export const QUOTE_STATUSES = ['requested', 'received', 'accepted', 'rejected'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** 상태별 한국어 라벨 + 색상 (P-9) */
export const QUOTE_STATUS_META: Record<
  QuoteStatus,
  { label: string; color: string; bgColor: string; description: string }
> = {
  requested: {
    label: '의뢰중',
    color: 'text-navy-600',
    bgColor: 'bg-navy-50',
    description: '견적 요청만 해놓고 답변 대기 중',
  },
  received: {
    label: '수신',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    description: '공급사 견적 받음 — 비교/검토 중',
  },
  accepted: {
    label: '확정',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    description: '이 견적으로 발주 진행',
  },
  rejected: {
    label: '거절',
    color: 'text-navy-400',
    bgColor: 'bg-navy-50',
    description: '더 좋은 견적이 있거나 진행 보류',
  },
};

/** 견적이 아직 열려있는(활성) 상태 = 비교 대상 */
export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ['requested', 'received'];

// ─────────────────────────────────────────────────────────
// 부가세 (VAT)
// ─────────────────────────────────────────────────────────

/** 한국 기본 부가세율 10% */
export const DEFAULT_VAT_RATE = 0.1;

/**
 * 단가 + VAT 포함 여부 → VAT 포함 최종단가 계산.
 * - vatIncluded=true  : unitPrice가 이미 포함가 → 그대로 반환
 * - vatIncluded=false : unitPrice에 (1 + vatRate) 곱함
 */
export function toPriceWithVat(
  unitPrice: number,
  vatRate: number,
  vatIncluded: boolean,
): number {
  if (vatIncluded) return unitPrice;
  return unitPrice * (1 + vatRate);
}

/**
 * VAT 포함가 → VAT 별도가 역산.
 */
export function toPriceWithoutVat(priceWithVat: number, vatRate: number): number {
  return priceWithVat / (1 + vatRate);
}
