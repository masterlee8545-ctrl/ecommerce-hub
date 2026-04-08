/**
 * seo_targets — SEO 목표 키워드
 *
 * 출처: docs/DATA_MODEL.md §4.5
 *
 * 역할: 상품별로 "이 키워드에서 N위 안에 들어가자"는 SEO 목표 설정.
 * 목표를 설정하면 keyword_rankings 표에서 자동으로 순위 추적이 시작된다.
 *
 * 흐름:
 * 1. 사용자가 상품 X를 "캠핑의자" 키워드 10위 목표로 등록
 * 2. BW Rank 시스템이 매일 순위를 측정해 keyword_rankings에 저장
 * 3. current_rank 컬럼에 최신 순위가 캐시됨 (대시보드 빠른 조회용)
 *
 * 핵심 제약:
 * - 한 상품에 같은 (키워드, 플랫폼) 조합은 unique
 */
import { boolean, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';

export const seoTargets = pgTable(
  'seo_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 대상 상품
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),

    // 목표 키워드
    keyword: text('keyword').notNull(),
    platform: text('platform').notNull(), //               'coupang'|'naver'

    // 순위 정보
    target_rank: integer('target_rank').notNull(), //      목표 순위 (예: 10)
    current_rank: integer('current_rank'), //              최신 순위 캐시 (대시보드용)

    // 활성화 (false = 추적 일시정지)
    is_active: boolean('is_active').notNull().default(true),

    // 시간
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 같은 상품의 같은 키워드+플랫폼 중복 등록 금지
    unique('seo_targets_product_keyword_platform_uniq').on(t.product_id, t.keyword, t.platform),
  ],
);

export type SeoTarget = typeof seoTargets.$inferSelect;
export type NewSeoTarget = typeof seoTargets.$inferInsert;
