/**
 * coupang_review_snapshots — 쿠팡 1페이지 리뷰 분석 결과
 *
 * 출처: docs/DATA_MODEL.md §3.4
 * ADR: ADR-008 (1페이지 36개 리뷰 분포 → 난이도 자동 판정)
 *
 * 역할: 쿠팡 키워드 검색 결과 1페이지(36개 상품)의 리뷰 분포를 분석한 스냅샷.
 * 6시간 캐시 (cache_expires_at). 만료 후엔 새로 수집.
 *
 * 핵심 비즈니스 로직 (ADR-008):
 * - reviews_under_300 / total ≥ 50% → 'easy' (진입 가능)
 * - reviews_under_500 / total ≥ 70% → 'medium'
 * - 그 외 → 'hard'
 */
import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { keywords } from './keywords';

export const coupangReviewSnapshots = pgTable(
  'coupang_review_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 키워드 연결 (선택 — 키워드 표 없이도 단독 분석 가능)
    keyword_id: uuid('keyword_id').references(() => keywords.id),
    keyword_text: text('keyword_text').notNull(), //               비정규화 (검색 편의)

    // ─── 리뷰 카운트 분포 ───
    total_products: integer('total_products').notNull(), //        보통 36
    reviews_under_100: integer('reviews_under_100').notNull(),
    reviews_100_299: integer('reviews_100_299').notNull(),
    reviews_300_499: integer('reviews_300_499').notNull(),
    reviews_500_999: integer('reviews_500_999').notNull(),
    reviews_1000_plus: integer('reviews_1000_plus').notNull(),

    // ─── 비율 (계산 캐시) ───
    ratio_under_300: decimal('ratio_under_300', { precision: 5, scale: 4 }).notNull(), // 0.6111
    ratio_under_500: decimal('ratio_under_500', { precision: 5, scale: 4 }).notNull(),

    // ─── 평균/중앙값 ───
    avg_review_count: integer('avg_review_count'),
    median_review_count: integer('median_review_count'),
    avg_price_krw: integer('avg_price_krw'),
    min_price_krw: integer('min_price_krw'),
    max_price_krw: integer('max_price_krw'),

    // ─── 자동 판정 결과 (ADR-008) ───
    difficulty_verdict: text('difficulty_verdict').notNull(), //   'easy' | 'medium' | 'hard'
    verdict_rule: text('verdict_rule').notNull(), //               'ratio_under_300_gte_50' 등

    // ─── 원본 데이터 (재분석용) ───
    raw_products: jsonb('raw_products').notNull(), //              [{rank, name, price, reviews, rating, seller}]

    // 시간 + 캐시
    collected_at: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
    api_source: text('api_source').notNull().default('coupang-api.zpost.shop'),
    cache_expires_at: timestamp('cache_expires_at', { withTimezone: true }).notNull(), // +6h
  },
  (t) => [index('crs_keyword_idx').on(t.company_id, t.keyword_text)],
);

export type CoupangReviewSnapshot = typeof coupangReviewSnapshots.$inferSelect;
export type NewCoupangReviewSnapshot = typeof coupangReviewSnapshots.$inferInsert;
