/**
 * ad_campaigns — 광고 캠페인 (Marketing 단계)
 *
 * 출처: docs/DATA_MODEL.md §4.1
 * ADR: ADR-009 (일일 예산 상한 강제 — daily_budget_cap_krw NOT NULL)
 *
 * 역할: 플랫폼(쿠팡 등)의 광고 캠페인 정보. 그룹 B의 listings → 광고 → 매출 흐름의 시작.
 * 한 상품(또는 무관)이 여러 캠페인에 묶일 수 있다.
 *
 * 라이프사이클: active → paused → ended
 *
 * 핵심 제약:
 * - daily_budget_cap_krw NOT NULL (ADR-009: 폭주 방지)
 * - roas_threshold default '3.5' (ROAS 목표치 350%)
 */
import { date, decimal, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';

export const adCampaigns = pgTable('ad_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 연결 (상품과 무관한 브랜드 캠페인도 가능 — nullable)
  product_id: uuid('product_id').references(() => products.id),

  // 플랫폼 식별
  platform: text('platform').notNull(), //                'coupang' (현 단계는 쿠팡만)
  external_campaign_id: text('external_campaign_id'), //  플랫폼의 캠페인 ID

  // 캠페인 정보
  name: text('name').notNull(),
  status: text('status').notNull(), //                    'active'|'paused'|'ended'

  // 예산 (ADR-009 — NOT NULL 강제)
  daily_budget_cap_krw: decimal('daily_budget_cap_krw', { precision: 12, scale: 2 }).notNull(),
  roas_threshold: decimal('roas_threshold', { precision: 5, scale: 2 }).default('3.5'), //  목표 ROAS (350%)

  // 기간
  start_date: date('start_date'),
  end_date: date('end_date'),

  // 시간 + 작성자
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
});

export type AdCampaign = typeof adCampaigns.$inferSelect;
export type NewAdCampaign = typeof adCampaigns.$inferInsert;
