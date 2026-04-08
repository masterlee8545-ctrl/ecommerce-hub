/**
 * tariff_presets — 관세율 프리셋
 *
 * 출처: docs/DATA_MODEL.md §5.3
 *
 * 역할: 자주 쓰는 관세율을 미리 등록해두는 표.
 * 발주(purchase_orders) 시 카테고리에 맞는 프리셋을 선택하면
 * 관세 + 부가세가 자동 계산된다.
 *
 * 시드 데이터 (기본 4종):
 * - 생활용품 — 관세 8%
 * - 의류 — 관세 13%
 * - 가전 소품 — 관세 8%
 * - 무관세 — 0%
 *
 * 모든 프리셋은 부가세 10% 기본값을 가진다.
 */
import { decimal, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';

export const tariffPresets = pgTable('tariff_presets', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 프리셋 정보
  name: text('name').notNull(), //                         '생활용품 8%'
  category: text('category'),

  // 세율 (소수 — 0.08 = 8%)
  tariff_rate: decimal('tariff_rate', { precision: 5, scale: 4 }).notNull(), //  0.08
  vat_rate: decimal('vat_rate', { precision: 5, scale: 4 }).notNull().default('0.10'), // 10%

  description: text('description'),

  // 시간
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type TariffPreset = typeof tariffPresets.$inferSelect;
export type NewTariffPreset = typeof tariffPresets.$inferInsert;
