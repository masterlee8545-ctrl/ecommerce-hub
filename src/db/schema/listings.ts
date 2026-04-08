/**
 * listings — 플랫폼 등록 (Listing 단계)
 *
 * 출처: docs/DATA_MODEL.md §3.8
 *
 * 역할: 상품을 외부 플랫폼(쿠팡/네이버 스마트스토어/11번가)에 등록한 정보.
 * 한 상품이 여러 플랫폼에 동시에 등록될 수 있음 (1:N).
 *
 * 라이프사이클: draft → pending_review → (active | rejected) → paused
 */
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 연결
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),

    // 플랫폼 식별
    platform: text('platform').notNull(), //               'coupang' | 'naver_smartstore' | '11st'
    external_product_id: text('external_product_id'), //   플랫폼의 상품 ID
    external_url: text('external_url'),

    // 상태
    status: text('status').notNull(), //                   'draft'|'pending_review'|'active'|'paused'|'rejected'

    // 등록 정보
    title: text('title'), //                                플랫폼 등록용 제목
    category_path: text('category_path'),

    // 시간
    listed_at: timestamp('listed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 한 상품을 같은 플랫폼에 두 번 등록 금지
    unique('listings_product_platform_uniq').on(t.product_id, t.platform),
  ],
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
