/**
 * product_plans — 상세페이지 기획서 (Step 4)
 *
 * 출처: 소싱 워크플로우 Step 4 — 상세페이지 기획서 작성 → 담당자 인계
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리), §1 P-1 (빈 결과 명시),
 *       §1 P-3 (AI 결과는 estimated 마킹 → result_confidence)
 *
 * 역할:
 * - 상품마다 "상세페이지를 어떻게 만들 것인가" 기획서를 저장
 * - AI 초안 생성(쿠팡 상위 경쟁사 제목 + 리뷰 불만포인트 기반) 결과 보관
 * - 기획서 담당자(plan_assignee_id) 가 보강·수정 후 상품등록 담당자에게 인계
 *
 * 섹션 구조 (sections jsonb):
 * Array<{
 *   position: number,          // 배열 순서
 *   title: string,             // 섹션 제목 (예: "후킹 - 첫 화면")
 *   imageDesc: string | null,  // 어떤 사진이 들어갈지 텍스트 설명
 *   color: string | null,      // 색상 톤 힌트 (예: "따뜻한 베이지")
 *   copy: string | null,       // 실제 카피 문구
 *   hook: string | null,       // 이 섹션의 후킹 포인트
 * }>
 *
 * 1 상품 : 1 기획서 (UNIQUE(product_id))
 */
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';

export const productPlans = pgTable(
  'product_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 대상 상품 (1:1)
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    // ─── 본문 ───
    /** 섹션 배열 (순서 있음). 구조는 파일 헤더 주석 참고. */
    sections: jsonb('sections').notNull().default([]),
    /** 기획서 전반의 후킹/차별화 요약 (사용자 편집) */
    hook_summary: text('hook_summary'),
    /** 타겟 고객 설명 (사용자 편집) */
    target_audience: text('target_audience'),
    /** 메모 — 담당자에게 전달할 특이사항 */
    notes: text('notes'),

    // ─── AI 생성 흔적 (있으면 estimated, 사용자가 수정하면 confidence 바뀜) ───
    /** AI 초안을 만들 때 사용한 프롬프트 (재현·디버깅용) */
    ai_prompt_used: text('ai_prompt_used'),
    /** 'estimated' (AI 초안) | 'edited' (사용자 수정) | 'confirmed' (최종) */
    result_confidence: text('result_confidence').notNull().default('estimated'),

    // ─── 시간 + 작성자 ───
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
    updated_by: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    // 상품당 1개만 존재
    unique('product_plans_product_uniq').on(t.product_id),
  ],
);

export type ProductPlan = typeof productPlans.$inferSelect;
export type NewProductPlan = typeof productPlans.$inferInsert;
