/**
 * ad_metrics — 광고 성과 (일별)
 *
 * 출처: docs/DATA_MODEL.md §4.4
 *
 * 역할: 광고 캠페인/그룹/키워드의 일일 성과 데이터.
 * BW Rank / 쿠팡 광고 API에서 매일 수집되는 시계열 메트릭.
 *
 * 주요 지표:
 * - impressions (노출수), clicks (클릭수), conversions (전환수)
 * - spend (광고비), revenue (광고로 발생한 매출)
 * - ROAS = revenue / spend (목표 350%)
 * - CTR = clicks / impressions
 * - CPC = spend / clicks
 *
 * 핵심 인덱스: (campaign_id, date) — 일별 차트 조회 최적화
 */
import { date, decimal, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { adCampaigns } from './ad-campaigns';
import { adGroups } from './ad-groups';
import { adKeywords } from './ad-keywords';
import { companies } from './companies';

export const adMetrics = pgTable(
  'ad_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 연결 (campaign은 필수, group/keyword는 집계 단위에 따라 nullable)
    campaign_id: uuid('campaign_id')
      .notNull()
      .references(() => adCampaigns.id),
    group_id: uuid('group_id').references(() => adGroups.id),
    keyword_id: uuid('keyword_id').references(() => adKeywords.id),

    // 측정 일자
    date: date('date').notNull(),

    // 핵심 지표
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend_krw: decimal('spend_krw', { precision: 12, scale: 2 }).notNull().default('0'),
    conversions: integer('conversions').notNull().default(0),
    revenue_krw: decimal('revenue_krw', { precision: 14, scale: 2 }).notNull().default('0'),

    // 계산 지표 (캐시)
    roas: decimal('roas', { precision: 6, scale: 2 }), //   revenue / spend
    ctr: decimal('ctr', { precision: 5, scale: 4 }), //     clicks / impressions
    cpc_krw: decimal('cpc_krw', { precision: 10, scale: 2 }), // spend / clicks

    // 메타
    recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    source: text('source').notNull(), //                    'coupang_api'|'manual'|'bw_rank'
  },
  (t) => [
    // 캠페인별 일별 차트 조회 최적화
    index('am_campaign_date_idx').on(t.campaign_id, t.date),
  ],
);

export type AdMetric = typeof adMetrics.$inferSelect;
export type NewAdMetric = typeof adMetrics.$inferInsert;
