/**
 * purchase_orders — 발주 (Importing 단계)
 *
 * 출처: docs/DATA_MODEL.md §3.7
 *
 * 역할: 견적 수락 후 실제 발주 정보. Importing 단계의 핵심.
 * 환율, 관세, 배송비를 포함한 최종 원가 계산의 근거 데이터.
 *
 * 라이프사이클: pending → paid → shipped → customs → received → (cancelled)
 */
import { decimal, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { quotes } from './quotes';
import { suppliers } from './suppliers';
import { users } from './users';

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 연결
  product_id: uuid('product_id')
    .notNull()
    .references(() => products.id),
  quote_id: uuid('quote_id').references(() => quotes.id),
  supplier_id: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),

  // 상태
  status: text('status').notNull(), //                     'pending'|'paid'|'shipped'|'customs'|'received'|'cancelled'

  // 수량 + 금액
  qty: integer('qty').notNull(),
  unit_price_cny: decimal('unit_price_cny', { precision: 12, scale: 2 }).notNull(),
  total_cny: decimal('total_cny', { precision: 14, scale: 2 }).notNull(),

  // 추가 비용 (한국 도착 기준 최종 원가 계산용)
  shipping_cost_krw: decimal('shipping_cost_krw', { precision: 12, scale: 2 }),
  customs_cost_krw: decimal('customs_cost_krw', { precision: 12, scale: 2 }),
  exchange_rate: decimal('exchange_rate', { precision: 10, scale: 4 }), //  적용 환율 (CNY/KRW)

  // 시간 흐름 (배송 추적)
  paid_at: timestamp('paid_at', { withTimezone: true }),
  shipped_at: timestamp('shipped_at', { withTimezone: true }),
  eta: timestamp('eta', { withTimezone: true }), //         예상 도착일
  received_at: timestamp('received_at', { withTimezone: true }),

  tracking_no: text('tracking_no'),

  // 시간 + 작성자
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
