/**
 * research_review_analyses — 쿠팡 리뷰 AI 분석 결과 저장
 *
 * 출처: docs/SPEC.md §3 Research, C-3 (쿠팡 리뷰 분석기) → D-1 (저장 + 히스토리)
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹 강제 — confidence='estimated'),
 *       §1 P-4 (멀티테넌트 격리), §1 P-1 (빈 결과 은폐 금지)
 *
 * 역할:
 * - C-3에서 만든 쿠팡 리뷰 AI 분석 결과를 영구 저장
 * - 사장님이 같은 키워드로 다시 분석하지 않도록 히스토리 제공
 * - "최근 분석한 경쟁 상품 5개" 같은 빠른 진입 카드의 데이터 소스
 *
 * coupang_review_snapshots와의 차이:
 * - coupang_review_snapshots: 1페이지 36개 상품의 리뷰 카운트 분포 (ADR-008 난이도 판정)
 * - research_review_analyses: 리뷰 텍스트의 AI 분석 (불만/장점/차별화 포인트)
 * - 두 표는 같은 키워드에 대해 동시에 존재할 수 있다 (서로 다른 관점)
 *
 * 핵심 제약:
 * - confidence는 항상 'estimated' (P-3 — 회계 계산에 사용 금지)
 * - raw_text_excerpt는 앞 500자만 저장 (원문 8000자 보관 금지 — 저장 비용 절약 + 개인정보)
 * - result jsonb는 AnalyzeResult 스키마 (src/lib/research/coupang-review-analyzer.ts)와 일치
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const researchReviewAnalyses = pgTable(
  'research_review_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키 (P-4)
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // ─── 입력 스냅샷 (재현·디버깅용) ───
    product_hint: text('product_hint'), //                  사용자가 입력한 카테고리/유형 힌트
    raw_text_excerpt: text('raw_text_excerpt').notNull(), // 원문 앞 500자만 저장
    raw_text_length: integer('raw_text_length').notNull(), // 원문 전체 길이 (참고용)

    // ─── AI 분석 결과 ───
    // jsonb 구조 = AnalyzeResult 스키마 (zod로 검증 후 저장)
    // {
    //   overallSummary: string,
    //   topComplaints: [{ text, frequencyHint, quote? }],
    //   topCompliments: [{ text, frequencyHint, quote? }],
    //   suggestedDifferentiators: [string],
    //   estimatedReviewCount: number,
    //   confidence: 'estimated'
    // }
    result: jsonb('result').notNull(),

    // ─── 메타 ───
    model: text('model').notNull(), //                      'claude-opus-4-5' 등 (감사 + 모델 변경 추적)
    confidence: text('confidence').notNull().default('estimated'), // P-3 강제

    // ─── 시간 + 작성자 ───
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // 회사별 최신 분석 조회 (히스토리 페이지의 핵심 인덱스)
    index('rra_company_created_idx').on(t.company_id, t.created_at),
  ],
);

export type ResearchReviewAnalysis = typeof researchReviewAnalyses.$inferSelect;
export type NewResearchReviewAnalysis = typeof researchReviewAnalyses.$inferInsert;
