/**
 * vendor_products — 농가 ↔ 취급 품목 다대다 (ADR-012)
 *
 * 출처: docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.10
 * 헌법: CLAUDE.md §1 P-3 (신뢰도), §1 P-4/P-5 (멀티테넌트)
 *
 * 역할:
 *   농가 1명이 취급하는 품목들. 자동 매칭 (2번 PR) 의 기반 인덱스.
 *   사이소의 productKeywordsAll 콤마 텍스트를 row 로 분해.
 */
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { vendors } from './vendors';

export const vendorProducts = pgTable(
  'vendor_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    vendor_id: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),

    product_keyword: text('product_keyword').notNull(), // 정규화된 품목 키워드

    source: text('source'), //                          '사이소-productKeywordsAll' | '사용자-수동'
    confidence: text('confidence').notNull().default('estimated'), // P-3

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 같은 농가에 같은 키워드 중복 방지
    unique('vendor_products_unique').on(t.vendor_id, t.product_keyword),

    index('idx_vendor_products_vendor').on(t.vendor_id),
    index('idx_vendor_products_keyword').on(t.product_keyword),
    index('idx_vendor_products_company').on(t.company_id),
  ],
);

export type VendorProduct = typeof vendorProducts.$inferSelect;
export type NewVendorProduct = typeof vendorProducts.$inferInsert;
