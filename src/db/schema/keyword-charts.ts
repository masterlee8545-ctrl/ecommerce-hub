/**
 * keyword_chart_daily / keyword_chart_fetches
 *
 * 셀록홈즈 chart API의 일별 ratio 영구 저장소.
 *
 * 역할:
 * - 키워드별 10년치 일별 ratio (0~100 상대지수) 누적 보관
 * - 한번 받으면 영구 캐시 (외부 데이터 — 시간 지나도 안 변함)
 * - 24시간 지나면 최근 30일만 갱신, 과거는 그대로
 *
 * 멀티테넌트 정책:
 * - 외부 데이터(셀록홈즈)라 모든 회사가 공유 → company_id 없음
 * - "내 추천 / 내 분석" 같은 사용자 데이터는 별도 테이블에서 멀티테넌트
 *
 * 사이즈 추정:
 * - 키워드당 일별 row ~3,800개 (10년 4개월)
 * - 1,000개 키워드 → 380만 row → ~120MB (idx 포함 추정)
 */
import { index, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * 일별 ratio (0~100) 영구 저장.
 * (keyword, period) 복합 PK로 중복 방지.
 */
export const keywordChartDaily = pgTable(
  'keyword_chart_daily',
  {
    keyword: text('keyword').notNull(),
    period: text('period').notNull(), // 'YYYY-MM-DD' (DATE 타입 대신 TEXT — JSON 호환 + 인덱스 빠름)
    ratio: real('ratio').notNull(), //  0~100 상대지수
  },
  (t) => [
    index('kcd_keyword_idx').on(t.keyword),
    index('kcd_period_idx').on(t.period),
    // 복합 PK
    index('kcd_keyword_period_idx').on(t.keyword, t.period),
  ],
);

export type KeywordChartDaily = typeof keywordChartDaily.$inferSelect;
export type NewKeywordChartDaily = typeof keywordChartDaily.$inferInsert;

/**
 * 키워드별 마지막 fetch 메타.
 * 24시간 캐시 판단 + UI 표시용.
 */
export const keywordChartFetches = pgTable(
  'keyword_chart_fetches',
  {
    keyword: text('keyword').primaryKey(),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    data_start_date: text('data_start_date'), //   가장 이른 데이터 날짜
    data_end_date: text('data_end_date'), //       가장 최근 데이터 날짜
    point_count: integer('point_count').notNull().default(0),
    /** 마지막 호출 결과: 'ok' | 'auth_expired' | 'no_data' | 'error' */
    last_status: text('last_status').notNull().default('ok'),
    last_error: text('last_error'),
  },
  (t) => [index('kcf_fetched_at_idx').on(t.fetched_at)],
);

export type KeywordChartFetch = typeof keywordChartFetches.$inferSelect;
export type NewKeywordChartFetch = typeof keywordChartFetches.$inferInsert;
