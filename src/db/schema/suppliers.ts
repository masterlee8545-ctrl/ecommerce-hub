/**
 * suppliers — 공급자 (주로 1688)
 *
 * 출처: docs/DATA_MODEL.md §3.5
 *
 * 역할: 상품 발주를 받을 공급자(중국 1688 셀러, 국내 도매상 등) 정보.
 * products.primary_supplier_id, quotes.supplier_id, purchase_orders.supplier_id에서 참조.
 */
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키 (P-5)
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 기본 정보
  name: text('name').notNull(), //                       예: '杭州XX贸易有限公司'
  source: text('source').notNull(), //                   '1688' | 'taobao' | 'domestic'
  source_url: text('source_url'),
  contact_info: text('contact_info'), //                 위챗 / 이메일 / 전화

  // 평가
  rating: integer('rating'), //                          1-5 (별점)
  notes: text('notes'),

  // 시간
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
