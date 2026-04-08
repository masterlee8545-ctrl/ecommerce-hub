/**
 * keyword_rankings — 키워드 순위 추적 (시계열)
 *
 * 출처: docs/DATA_MODEL.md §4.6
 *
 * 역할: seo_targets에 등록된 키워드의 일별 순위 측정 결과.
 * 시계열 데이터 — 차트로 순위 변동을 시각화하는 원천 데이터.
 *
 * 데이터 패턴:
 * - 매일 1회 측정 (BW Rank 자동 / 수동 입력 가능)
 * - rank가 null = 측정일 기준 미노출 (페이지 밖)
 *
 * 핵심 인덱스: (seo_target_id, recorded_at) — 시계열 차트 조회 최적화
 */
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { seoTargets } from './seo-targets';

export const keywordRankings = pgTable(
  'keyword_rankings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 추적 대상
    seo_target_id: uuid('seo_target_id')
      .notNull()
      .references(() => seoTargets.id),

    // 순위 정보
    rank: integer('rank'), //                              null = 미노출 (페이지 밖)
    page: integer('page'), //                              1, 2, 3...

    // 측정 시간
    recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    source: text('source').notNull(), //                   'bw_rank'|'manual'
  },
  (t) => [
    // 시계열 차트 조회 최적화 (최신 N건)
    index('kr_target_time_idx').on(t.seo_target_id, t.recorded_at),
  ],
);

export type KeywordRanking = typeof keywordRankings.$inferSelect;
export type NewKeywordRanking = typeof keywordRankings.$inferInsert;
