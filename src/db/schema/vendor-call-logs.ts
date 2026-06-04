/**
 * vendor_call_logs — 농가 통화/카톡/방문 기록 (IMMUTABLE)
 *
 * 출처: docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.11
 * 헌법: CLAUDE.md §1 P-4/P-5 (멀티테넌트 + 영업비밀 격리)
 * ADR: ADR-010 (Audit 표는 INSERT/SELECT 만), ADR-013 D-3 (완전 격리)
 *
 * 역할:
 *   농가 통화 결과를 30초 안에 기록. 회사별 완전 격리.
 *   1번 PR 에서 스키마만, 통화 모달 + 활용은 3번 PR.
 *
 * 핵심 제약:
 *   - immutable (UPDATE/DELETE 정책 없음 → SQL 레벨에서 거부)
 *   - 회사별 완전 격리 (ADR-013 D-3 — 영업 비밀 보호)
 */
import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';
import { vendors } from './vendors';

export const vendorCallLogs = pgTable(
  'vendor_call_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 (P-5, ADR-013 D-3)
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 대상
    vendor_id: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    product_id: uuid('product_id').references(() => products.id),

    // 통화 내용
    channel: text('channel').notNull(), //               'phone' | 'kakao' | 'visit' | 'other'
    result: text('result').notNull(), //                 '연결됨' | ...
    notes: text('notes'),

    // 공급가 / MOQ (형 요청 — 통화 후 즉시 기록)
    /** 공급가 (원) — 예: 1kg 단가 */
    supplier_price: numeric('supplier_price', { precision: 12, scale: 0 }),
    /** 단가 단위 — 'kg' | '박스' | '개' | 'L' */
    supplier_price_unit: text('supplier_price_unit'),
    /** 최소주문수량 */
    moq: integer('moq'),
    /** MOQ 단위 — '박스' | '개' | 'kg' */
    moq_unit: text('moq_unit'),

    // 후속 액션
    next_action: text('next_action'), //                 '재통화' | '견본_대기' | '계약_검토' | NULL
    next_action_at: timestamp('next_action_at', { withTimezone: true }),

    // 통화자
    called_by_user_id: uuid('called_by_user_id')
      .notNull()
      .references(() => users.id),
    called_at: timestamp('called_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_vcl_vendor').on(t.vendor_id),
    index('idx_vcl_product').on(t.product_id),
    index('idx_vcl_company').on(t.company_id),
    index('idx_vcl_next_action').on(t.next_action_at),
  ],
);

export type VendorCallLog = typeof vendorCallLogs.$inferSelect;
export type NewVendorCallLog = typeof vendorCallLogs.$inferInsert;
