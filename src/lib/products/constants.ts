/**
 * 상품(products) 도메인 상수 — 서버/클라이언트 공용
 *
 * 출처: docs/SPEC.md §3 (6단계 파이프라인), §7 (15종 task_type)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 'use client' 컴포넌트가 직접 import 할 수 있는 순수 상수
 * - DB 모듈 의존성 0 (postgres, drizzle 등 import 금지)
 *
 * 6단계 파이프라인:
 * 1. research   — 키워드/리뷰 분석
 * 2. sourcing   — 공급사 견적
 * 3. importing  — 발주/통관
 * 4. listing    — 쿠팡/네이버 등록
 * 5. active     — 판매중
 * 6. branding   — 브랜딩 (선택)
 */

// ─────────────────────────────────────────────────────────
// 파이프라인 단계
// ─────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  'research',
  'sourcing',
  'importing',
  'listing',
  'active',
  'branding',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** 단계별 한국어 라벨 + 설명 (P-9) */
export const PIPELINE_STAGE_META: Record<
  PipelineStage,
  { label: string; description: string; color: string; bgColor: string }
> = {
  research: {
    label: '리서치',
    description: '키워드/리뷰 분석',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
  },
  sourcing: {
    label: '소싱',
    description: '공급사 견적',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
  },
  importing: {
    label: '수입',
    description: '발주/통관',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
  },
  listing: {
    label: '등록',
    description: '쿠팡/네이버 등록',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
  },
  active: {
    label: '판매중',
    description: '판매 관리',
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
  },
  branding: {
    label: '브랜딩',
    description: '브랜드 강화',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
  },
};

// ─────────────────────────────────────────────────────────
// 신뢰도 (P-3, ADR-007)
// ─────────────────────────────────────────────────────────

export const CONFIDENCE_LEVELS = ['confirmed', 'estimated', 'unknown'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; color: string }> = {
  confirmed: { label: '확정', color: 'bg-emerald-50 text-emerald-700' },
  estimated: { label: '추정', color: 'bg-yellow-50 text-yellow-700' },
  unknown: { label: '미정', color: 'bg-navy-50 text-navy-500' },
};

// ─────────────────────────────────────────────────────────
// 상태 전이 규칙 (직진형 — 6단계 순서)
// ─────────────────────────────────────────────────────────

/**
 * 각 단계에서 한 번에 전환 가능한 다음 단계.
 * 보통은 +1단계만 허용하지만, listing → active는 검토 후 진행.
 *
 * 정책:
 * - branding은 최종 단계 (다음 없음)
 * - 뒤로 되돌리기는 별도 함수 (revertProductStatus)에서 처리 — 현재 미구현
 */
export const NEXT_STAGES: Record<PipelineStage, PipelineStage[]> = {
  research: ['sourcing'],
  sourcing: ['importing'],
  importing: ['listing'],
  listing: ['active'],
  active: ['branding'],
  branding: [],
};

// ─────────────────────────────────────────────────────────
// task_type 자동 생성 매핑 (ADR-005, SPEC §7)
// ─────────────────────────────────────────────────────────

export const TASK_TYPES = [
  'quote_request_1688',
  'payment_confirm',
  'customs_track',
  'detail_page_design',
  'product_photo',
  'seo_keyword_setup',
  'ad_campaign_create',
  'keyword_rank_monitor',
  'ad_budget_review',
  'ad_keyword_bid_adjust',
  'seo_review',
  'restock_decision',
  'customs_escalate',
  'settlement_review',
  'brand_store_design',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

/**
 * 단계 전이 시 자동으로 만들 task 정의 (멱등 키 base는 코드에서 생성).
 * 키: 'fromStage:toStage', 값: task 생성 명세 배열.
 */
export interface TransitionTaskSpec {
  taskType: TaskType;
  title: string;
  /** 마감까지 일 수 (D-day). 0이면 마감 없음(상시). */
  daysUntilDue: number;
  /** 우선순위 */
  priority: 'urgent' | 'high' | 'normal' | 'low';
}

export const TRANSITION_TASK_MAP: Record<string, TransitionTaskSpec[]> = {
  // 리서치 → 소싱: 1688 견적 의뢰 (D-5)
  'research:sourcing': [
    {
      taskType: 'quote_request_1688',
      title: '1688 견적 의뢰',
      daysUntilDue: 5,
      priority: 'normal',
    },
  ],
  // 소싱 → 수입: 결제 확정 + 통관 추적
  'sourcing:importing': [
    {
      taskType: 'payment_confirm',
      title: '발주 결제 확정',
      daysUntilDue: 2,
      priority: 'high',
    },
    {
      taskType: 'customs_track',
      title: '통관/배송 추적',
      daysUntilDue: 0,
      priority: 'normal',
    },
  ],
  // 수입 → 등록: 디자인/촬영/SEO/광고 동시 시작 (4종)
  'importing:listing': [
    {
      taskType: 'detail_page_design',
      title: '상세페이지 디자인',
      daysUntilDue: 3,
      priority: 'high',
    },
    {
      taskType: 'product_photo',
      title: '상품 촬영',
      daysUntilDue: 2,
      priority: 'high',
    },
    {
      taskType: 'seo_keyword_setup',
      title: 'SEO 키워드 등록',
      daysUntilDue: 1,
      priority: 'normal',
    },
    {
      taskType: 'ad_campaign_create',
      title: '쿠팡 광고 캠페인 생성',
      daysUntilDue: 1,
      priority: 'normal',
    },
  ],
  // 등록 → 판매중: 모니터링 시작
  'listing:active': [
    {
      taskType: 'keyword_rank_monitor',
      title: '키워드 순위 모니터링',
      daysUntilDue: 0,
      priority: 'normal',
    },
    {
      taskType: 'ad_budget_review',
      title: '광고 예산 검토',
      daysUntilDue: 7,
      priority: 'normal',
    },
  ],
  // 판매중 → 브랜딩: 브랜드 스토어
  'active:branding': [
    {
      taskType: 'brand_store_design',
      title: '브랜드 스토어 기획',
      daysUntilDue: 30,
      priority: 'low',
    },
  ],
};

/**
 * 단계 전이의 멱등 키 생성.
 * 형식: 'transition:{productId}:{from}:{to}:{taskType}'
 * tasks 표의 idempotency_key UNIQUE 제약과 일치 (ADR-005).
 */
export function buildTransitionIdempotencyKey(
  productId: string,
  from: PipelineStage,
  to: PipelineStage,
  taskType: TaskType,
): string {
  return `transition:${productId}:${from}:${to}:${taskType}`;
}
