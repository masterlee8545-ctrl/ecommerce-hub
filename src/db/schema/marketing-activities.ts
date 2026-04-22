/**
 * marketing_activities — 마케팅·리뷰 작업 트래킹 (Step 7)
 *
 * 출처: 소싱 워크플로우 Step 7 — 쿠팡/네이버 등록 후 리뷰 체험단/광고 작업
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리), §1 P-1 (빈 결과 명시)
 *
 * 역할:
 * - 상품마다 어떤 마케팅 채널을 몇 번 돌렸는지 기록
 * - 비용, 결과(리뷰수/도달수), 담당자 트래킹
 * - listing → active 전환 전 "어떤 마케팅이 돌아갔나" 확인용
 *
 * 채널:
 * - coupang_review    — 쿠팡 리뷰 체험단
 * - naver_review      — 네이버 리뷰 체험단
 * - blog              — 블로그 포스팅
 * - instagram         — 인스타그램
 * - youtube           — 유튜브 (인플루언서 포함)
 * - cafe              — 네이버 카페/커뮤니티
 * - coupang_cpc       — 쿠팡 CPC 광고
 *
 * 상태:
 * - pending     — 발주·협업 예정 (담당자 배정 전)
 * - in_progress — 진행 중
 * - done        — 완료 (결과 기록됨)
 * - cancelled   — 취소 (환불·협업 취소 등)
 *
 * 여러 채널을 동시에 돌릴 수 있으므로 상품당 N개 row 생성 가능.
 */
import {
  decimal,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';

/** UI 에서 선택지로 노출할 채널 코드 (DB text, 코드에서 enum 처리) */
export const MARKETING_CHANNELS = [
  'coupang_review',
  'naver_review',
  'blog',
  'instagram',
  'youtube',
  'cafe',
  'coupang_cpc',
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const MARKETING_CHANNEL_LABELS: Record<MarketingChannel, string> = {
  coupang_review: '쿠팡 리뷰 체험단',
  naver_review: '네이버 리뷰 체험단',
  blog: '블로그 포스팅',
  instagram: '인스타그램',
  youtube: '유튜브',
  cafe: '네이버 카페',
  coupang_cpc: '쿠팡 CPC 광고',
};

export const MARKETING_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'cancelled',
] as const;
export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

export const marketingActivities = pgTable(
  'marketing_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 대상 상품
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    // 채널 · 상태
    channel: text('channel').notNull(), //          MarketingChannel
    status: text('status').notNull().default('pending'), // MarketingStatus

    // 담당자 · 비용
    assignee_id: uuid('assignee_id').references(() => users.id),
    cost_krw: decimal('cost_krw', { precision: 12, scale: 2 }), // 실집행 비용

    // 진행 타임스탬프
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),

    // 결과
    /** 자유 텍스트 — 예: "리뷰 5건 달성 / 도달 2300명" */
    result_summary: text('result_summary'),
    /** 외부 링크 (블로그 URL, 유튜브 영상, 대시보드 스크린샷 등) */
    result_url: text('result_url'),
    /** 메모 — 문제·배운 점 */
    notes: text('notes'),

    // 시간 + 작성자
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // 상품별 활동 목록 (상세 페이지 탭)
    index('ma_product_idx').on(t.product_id, t.created_at),
    // 회사별 전체 활동 조회
    index('ma_company_status_idx').on(t.company_id, t.status),
  ],
);

export type MarketingActivity = typeof marketingActivities.$inferSelect;
export type NewMarketingActivity = typeof marketingActivities.$inferInsert;
