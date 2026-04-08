/**
 * ad_keywords — 광고 키워드 + 입찰가
 *
 * 출처: docs/DATA_MODEL.md §4.3
 *
 * 역할: 광고 그룹에 등록된 검색 키워드와 입찰가.
 * 사용자가 "캠핑의자"를 검색했을 때 우리 광고가 노출되도록 등록한 키워드.
 *
 * 핵심 제약:
 * - 한 그룹 내 같은 키워드+매칭타입 조합은 unique
 */
import { decimal, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { adGroups } from './ad-groups';
import { companies } from './companies';

export const adKeywords = pgTable(
  'ad_keywords',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 부모 그룹
    group_id: uuid('group_id')
      .notNull()
      .references(() => adGroups.id),

    // 키워드 정보
    keyword: text('keyword').notNull(),
    match_type: text('match_type').notNull(), //          'exact'|'phrase'|'broad'
    bid_krw: decimal('bid_krw', { precision: 10, scale: 2 }).notNull(),
    status: text('status').notNull(), //                  'active'|'paused'

    // 시간
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 그룹 내 같은 키워드+매칭타입 중복 등록 금지
    unique('ad_keywords_group_keyword_match_uniq').on(t.group_id, t.keyword, t.match_type),
  ],
);

export type AdKeyword = typeof adKeywords.$inferSelect;
export type NewAdKeyword = typeof adKeywords.$inferInsert;
