/**
 * keywords — 분석한 키워드
 *
 * 출처: docs/DATA_MODEL.md §3.3
 * 헌법: CLAUDE.md §10 신뢰도 마킹 (Claude 추정 마진은 항상 'estimated')
 * ADR: ADR-007 (마진은 추정), ADR-008 (난이도 자동 판정)
 *
 * 역할: 시장 조사(Research) 단계에서 분석한 키워드 데이터.
 * 검색량(네이버), 마진(Claude 추정), 난이도(쿠팡 리뷰 분포 기반) 통합.
 */
import {
  boolean,
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const keywords = pgTable(
  'keywords',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 키워드
    keyword: text('keyword').notNull(),
    source: text('source').notNull(), //                  'naver' | 'coupang' | 'manual'

    // ─── 검색량 (네이버 데이터랩) ───
    monthly_search_pc: integer('monthly_search_pc'),
    monthly_search_mobile: integer('monthly_search_mobile'),
    monthly_search_total: integer('monthly_search_total'),
    search_data_confidence: text('search_data_confidence').default('unknown'), // ADR-007

    // ─── 가격 ───
    avg_price_krw: decimal('avg_price_krw', { precision: 12, scale: 2 }),

    // ─── 마진 (Claude 추정 — 항상 estimated) ───
    estimated_margin_rate: decimal('estimated_margin_rate', { precision: 5, scale: 4 }),
    margin_confidence: text('margin_confidence').default('estimated'), //         ADR-007 강제
    margin_reasoning: text('margin_reasoning'), //                                Claude 생성 근거

    // ─── 난이도 (쿠팡 리뷰 분포 자동 판정 — ADR-008) ───
    difficulty: text('difficulty'), //                    'easy' | 'medium' | 'hard'
    difficulty_basis_snapshot_id: uuid('difficulty_basis_snapshot_id'), //        → coupang_review_snapshots

    // ─── 추적 ───
    is_tracked: boolean('is_tracked').notNull().default(false),
    analyzed_at: timestamp('analyzed_at', { withTimezone: true }).defaultNow().notNull(),

    // 시간 + 작성자
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [index('kw_company_keyword_idx').on(t.company_id, t.keyword)],
);

export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;
