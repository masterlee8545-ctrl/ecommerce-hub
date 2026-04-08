/**
 * product_state_history — 상품 상태 변경 이력 (Immutable)
 *
 * 출처: docs/DATA_MODEL.md §3.2
 * ADR: ADR-010 (Audit 표는 INSERT/SELECT만 허용, UPDATE/DELETE 금지)
 *
 * 역할: 상품의 status 컬럼 변경 로그. 6단계 파이프라인의 이동 이력.
 *
 * 핵심 제약 (RLS로 강제):
 * - INSERT만 가능
 * - UPDATE 금지
 * - DELETE 금지
 * - 한 번 기록된 이력은 영구 보존 (회계 감사 대비)
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';

export const productStateHistory = pgTable(
  'product_state_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),

    // 상태 전이
    from_status: text('from_status'), //                    null = 최초 등록
    to_status: text('to_status').notNull(),

    // 누가 언제 왜
    changed_by: uuid('changed_by').references(() => users.id),
    changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
    reason: text('reason'), //                              사용자 입력 사유 (선택)
  },
  (t) => [index('psh_product_idx').on(t.product_id)],
);

export type ProductStateHistory = typeof productStateHistory.$inferSelect;
export type NewProductStateHistory = typeof productStateHistory.$inferInsert;
