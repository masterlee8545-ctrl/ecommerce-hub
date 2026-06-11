/**
 * products — 상품 (라이프사이클 + 모든 단계 통합)
 *
 * 출처: docs/DATA_MODEL.md §3.1
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹 강제), §10 (마진은 estimated)
 * ADR: ADR-007 (cogs/margin은 추정값, *_confidence 컬럼 강제)
 *
 * 역할: 5단계 파이프라인(Research → Sourcing → Importing → Listing → Active)을
 * 거치는 상품의 마스터 표. 모든 단계가 이 표를 중심으로 연결된다.
 *
 * 핵심 제약:
 * - 회사 내 상품 코드(code)는 unique
 * - cogs_cny / margin_rate는 항상 *_confidence 컬럼 동반 (P-3)
 * - 추정값(estimated)은 회계 계산에 직접 사용 금지 (CLAUDE.md §10.6)
 */
import {
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { keywords } from './keywords';
import { suppliers } from './suppliers';
import { users } from './users';
import { vendors } from './vendors';

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 상품 식별
    code: text('code').notNull(), //                       'PROD-2026-0042' (회사 내 unique)
    name: text('name').notNull(),
    category: text('category'), //                         '생활용품', '농산물' 등

    // 파이프라인 단계 (6단계 + research)
    status: text('status').notNull(), //                   'research'|'sourcing'|'importing'|'listing'|'active'

    // ─── 가격 정보 (모두 *_confidence 강제 — P-3) ───
    cogs_cny: decimal('cogs_cny', { precision: 12, scale: 2 }), //         원가 (위안)
    cogs_cny_confidence: text('cogs_cny_confidence').default('unknown'), // ADR-007: 'confirmed'|'estimated'|'unknown'
    cogs_krw: decimal('cogs_krw', { precision: 12, scale: 2 }), //         환율+관세+배송 포함 최종원가
    selling_price_krw: decimal('selling_price_krw', { precision: 12, scale: 2 }),
    margin_rate: decimal('margin_rate', { precision: 5, scale: 4 }), //    0.4178
    margin_rate_confidence: text('margin_rate_confidence').default('unknown'),

    // ─── 소싱 관련 ───
    primary_supplier_id: uuid('primary_supplier_id').references(() => suppliers.id),
    primary_keyword_id: uuid('primary_keyword_id').references(() => keywords.id),
    /**
     * 1688 (또는 타오바오/알리바바) 소스 URL.
     * 수입업체에 인계 시 참조 — 외부 공급자가 동일 상품을 찾아 견적 낼 때 사용.
     */
    cn_source_url: text('cn_source_url'),

    // ─── 공급망 분기 (ADR-012 D-2) ───
    /**
     * 'domestic_vendor' | 'overseas_supplier' | 'both' | NULL.
     * NULL = 사용자가 아직 결정 안 함 (탭 둘 다 노출).
     * 5번 PR 에서 시즌 펄스 담기 시 자동 추론.
     */
    supply_type: text('supply_type'),
    /**
     * 국내 농가 공급처 (확정된 경우).
     * primary_supplier_id 와 별개 (의미 충돌 회피, ADR-012 D-1).
     */
    primary_vendor_id: uuid('primary_vendor_id').references(() => vendors.id),

    // ─── 시즌 메타 (시즌 펄스 → 담기 시 자동 채움, ADR-012 D-5) ───
    /** 1~12, 피크 검색 월 */
    season_peak_month: integer('season_peak_month'),
    /** 1~12, 소싱 준비 시작 월 (보통 피크 -2 개월) */
    season_prep_month: integer('season_prep_month'),
    /** 피크 / 바닥 6개월 평균 (예: 12.50배) */
    seasonality_ratio: numeric('seasonality_ratio', { precision: 5, scale: 2 }),
    /** 시즌 펄스 5점 스코어링 (5/4/2/1) */
    season_score: integer('season_score'),

    // ─── 시장 가격 (쿠팡 + 네이버 1~10등 가격대) ───
    /** 쿠팡 1페이지 최저가 */
    coupang_price_min: numeric('coupang_price_min', { precision: 12, scale: 0 }),
    /** 쿠팡 1페이지 중간값 */
    coupang_price_median: numeric('coupang_price_median', { precision: 12, scale: 0 }),
    /** 쿠팡 1페이지 최고가 */
    coupang_price_max: numeric('coupang_price_max', { precision: 12, scale: 0 }),
    /** 쿠팡 가격 표본 수 */
    coupang_price_sample_size: integer('coupang_price_sample_size'),
    /** 네이버 쇼핑 상위 최저가 */
    naver_price_min: numeric('naver_price_min', { precision: 12, scale: 0 }),
    naver_price_median: numeric('naver_price_median', { precision: 12, scale: 0 }),
    naver_price_max: numeric('naver_price_max', { precision: 12, scale: 0 }),
    naver_price_sample_size: integer('naver_price_sample_size'),
    /** 시장 가격 마지막 업데이트 */
    market_prices_updated_at: timestamp('market_prices_updated_at', { withTimezone: true }),
    /** 쿠팡 1~20등 상품명+가격+URL (jsonb 배열) — 형 요청: 농산물 중량/개수 다양 */
    coupang_top_listings: jsonb('coupang_top_listings'),
    /** 네이버 쇼핑 1~10등 상품명+가격+URL+몰명 (jsonb 배열) */
    naver_top_listings: jsonb('naver_top_listings'),
    /** 쿠팡 1페이지 평균 리뷰수 — 참고용 (1만+ 1위가 평균 끌어올림) */
    coupang_avg_review_count: integer('coupang_avg_review_count'),
    /** 쿠팡 1페이지 최대 리뷰수 */
    coupang_max_review_count: integer('coupang_max_review_count'),
    /** 추정 월간 검색량 (정확도 ↓, 셀록홈즈 키워드 페이지 별도 호출 필요) */
    monthly_search_volume: integer('monthly_search_volume'),
    /** ⭐ 형 핵심 메트릭: 1페이지 20개 중 리뷰 300 이하 상품 수 (진입 자리) */
    coupang_low_review_count: integer('coupang_low_review_count'),

    // ─── 선정 보완 지표 (0022) ───
    /** 쿠팡 1페이지 광고 상품 수 — 8+ 이면 광고 의존 시장 */
    coupang_ad_count: integer('coupang_ad_count'),
    /** 1위 리뷰 점유율 % — 30%+ 이면 1등 독점 시장 경고 */
    coupang_top1_share: numeric('coupang_top1_share', { precision: 5, scale: 1 }),
    /** 상위 3개 리뷰 점유율 % */
    coupang_top3_share: numeric('coupang_top3_share', { precision: 5, scale: 1 }),
    /** 검색량 YoY 성장률 % (최근 91일 vs 작년 동기, keyword_chart_daily) */
    search_growth_pct: numeric('search_growth_pct', { precision: 6, scale: 1 }),

    // 담당자 (3종 — 워크플로우 책임 분리)
    owner_user_id: uuid('owner_user_id').references(() => users.id),
    /** 상세페이지 기획·제작 담당 (Step 4) */
    plan_assignee_id: uuid('plan_assignee_id').references(() => users.id),
    /** 상품 등록 담당 (Step 6) */
    listing_assignee_id: uuid('listing_assignee_id').references(() => users.id),
    /** 로켓 입점 담당 (Step 8) */
    rocket_assignee_id: uuid('rocket_assignee_id').references(() => users.id),

    // 메타
    thumbnail_url: text('thumbnail_url'),
    description: text('description'),

    // 시간 + 작성자
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // 회사 내 상품 코드는 unique
    unique('products_company_code_uniq').on(t.company_id, t.code),

    // 상태별 목록 조회
    index('products_status_idx').on(t.company_id, t.status),

    // 내가 담당한 상품
    index('products_owner_idx').on(t.owner_user_id),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
