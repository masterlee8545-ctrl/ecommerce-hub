/**
 * product_vendor_candidates — 상품 ↔ 농가 공급처 후보
 *
 * 출처: docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.12
 * 헌법: CLAUDE.md §1 P-4/P-5 (멀티테넌트)
 * ADR: ADR-012, ADR-013 D-3
 *
 * 역할:
 *   상품 1개에 농가 후보 N명 매핑. 자동 매칭 결과 + 사용자 결정 (후보/통화중/견본중/확정/탈락).
 *   1번 PR 에서 스키마만, 활용은 2번 PR.
 */
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';
import { vendors } from './vendors';

export const productVendorCandidates = pgTable(
  'product_vendor_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    vendor_id: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),

    // 후보 상태
    status: text('status').notNull().default('후보'),
    //                                                     '후보' | '통화중' | '견본중' | '확정' | '탈락'

    // 매칭 정보
    match_score: numeric('match_score', { precision: 5, scale: 2 }), // 0~100
    match_reason: text('match_reason'),

    notes: text('notes'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    unique('pvc_unique').on(t.product_id, t.vendor_id),

    index('idx_pvc_product').on(t.product_id),
    index('idx_pvc_vendor').on(t.vendor_id),
    index('idx_pvc_status').on(t.status),
    index('idx_pvc_company').on(t.company_id),
  ],
);

export type ProductVendorCandidate = typeof productVendorCandidates.$inferSelect;
export type NewProductVendorCandidate = typeof productVendorCandidates.$inferInsert;
