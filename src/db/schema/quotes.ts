/**
 * quotes — 견적 (Sourcing 단계)
 *
 * 출처: docs/DATA_MODEL.md §3.6, F-1b (KRW/VAT 컬럼 추가)
 *
 * 역할: 공급자(suppliers)에게 받은 견적 정보.
 * Sourcing 단계 → Importing 단계로 넘어가기 위한 비교/결정의 근거.
 *
 * 단가 정책 (F 단계 사장님 거래 구조 반영):
 * - 사장님은 국내 수입 대행업체와 거래 → 단가는 원화(KRW) 기본
 * - 위안(CNY) 단가는 나중에 직거래 대비로 유지
 * - VAT는 보통 분리 표시 (단가 + VAT 10%)
 *
 * 라이프사이클: requested → received → (accepted | rejected)
 */
import { boolean, decimal, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { suppliers } from './suppliers';
import { users } from './users';

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 연결
  product_id: uuid('product_id').references(() => products.id),
  supplier_id: uuid('supplier_id').references(() => suppliers.id),

  // 상태
  status: text('status').notNull().default('requested'), // 'requested'|'received'|'accepted'|'rejected'

  // ─── 단가 (원화 기본, 위안 선택) ───
  /** 공급단가 (원화) — VAT 별도/포함 여부는 vat_included 참조. 사장님 주력. */
  unit_price_krw: decimal('unit_price_krw', { precision: 12, scale: 2 }),
  /** 공급단가 (위안) — 직거래 대비용. 대행거래 시 미사용. */
  unit_price_cny: decimal('unit_price_cny', { precision: 12, scale: 2 }),
  /** 부가세율 (기본 0.10 = 10%) */
  vat_rate: decimal('vat_rate', { precision: 5, scale: 4 }).default('0.1000'),
  /** 단가에 VAT가 포함됐는지. false면 별도 (사장님 케이스 기본). */
  vat_included: boolean('vat_included').notNull().default(false),

  // ─── 거래 조건 ───
  moq: integer('moq'), //                                  최소 주문수량 (Minimum Order Quantity)
  lead_time_days: integer('lead_time_days'), //            제작 + 배송 일수
  /** 결제조건 — "선금 30%", "전액 후불" 등 자유 텍스트 */
  payment_terms: text('payment_terms'),
  notes: text('notes'),
  spec_text: text('spec_text'), //                         사양 설명

  // ─── 벌크 임포트 추적 (F-2) ───
  /** 어느 파일에서 임포트됐는지 (예: 'xxx_카탈로그_2026Q2.xlsx') */
  source_file_name: text('source_file_name'),
  /** 원본 엑셀의 몇 번째 행이었는지 (디버깅 + 재임포트 방지) */
  source_row: integer('source_row'),

  // 시간 흐름
  requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  received_at: timestamp('received_at', { withTimezone: true }),
  decided_at: timestamp('decided_at', { withTimezone: true }),

  // 작성자
  created_by: uuid('created_by').references(() => users.id),
});

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;
