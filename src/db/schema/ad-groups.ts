/**
 * ad_groups — 광고 그룹
 *
 * 출처: docs/DATA_MODEL.md §4.2
 *
 * 역할: 캠페인 하위 단위. 캠페인 1개는 여러 광고 그룹을 가질 수 있다.
 * 광고 그룹 1개는 여러 키워드(ad_keywords)를 가진다.
 *
 * 구조: ad_campaigns (1) → ad_groups (N) → ad_keywords (N)
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { adCampaigns } from './ad-campaigns';
import { companies } from './companies';

export const adGroups = pgTable('ad_groups', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 부모 캠페인
  campaign_id: uuid('campaign_id')
    .notNull()
    .references(() => adCampaigns.id),

  // 그룹 정보
  name: text('name').notNull(),
  status: text('status').notNull(), //                    'active'|'paused'

  // 시간
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AdGroup = typeof adGroups.$inferSelect;
export type NewAdGroup = typeof adGroups.$inferInsert;
