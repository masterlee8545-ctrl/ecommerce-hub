/**
 * 배치 분석 필터 조건 평가기
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-9 (한국어)
 *
 * 역할:
 * - FirstPageMetrics 을 받아 "이 키워드가 통과 조건을 만족하는지" 판정
 * - 세 축: 리뷰수 분포 / 로켓 비율 / 가격 중앙값 (AND 조합)
 */
import type { FirstPageMetrics } from '../sello-scraper/metrics';

/** 배치 분석 필터 조건 */
export interface BatchFilterCondition {
  /** 리뷰수 임계값 (예: 300) */
  reviewThreshold: number;
  /** "임계값 미만인 상품이 전체의 X 이상" — 0~1 (예: 0.5 = 과반수) */
  minBelowReviewRatio: number;

  /** 로켓 비율 상한 (선택) — 이보다 크면 탈락 (0~1) */
  maxRocketRatio?: number | null;

  /** 가격 중앙값 범위 (선택) — KRW 원 단위 */
  priceMedianMin?: number | null;
  priceMedianMax?: number | null;
}

/** 필터 통과 결과 + 진단 */
export interface BatchFilterResult {
  passed: boolean;
  /** 리뷰 임계값 미만 상품 수 / 전체 */
  belowReviewCount: number;
  belowReviewRatio: number;
  /** 각 축별 통과 여부 (디버깅 + UI 에서 어떤 조건이 탈락시켰는지 표시) */
  checks: {
    reviewPassed: boolean;
    rocketPassed: boolean;
    pricePassed: boolean;
  };
  /** 탈락 사유 (passed=false 일 때) */
  failReason: string | null;
}

/**
 * 기본 조건: 리뷰 300 미만 과반수 이상, 로켓/가격 조건 없음.
 */
export const DEFAULT_BATCH_CONDITION: BatchFilterCondition = {
  reviewThreshold: 300,
  minBelowReviewRatio: 0.5,
  maxRocketRatio: null,
  priceMedianMin: null,
  priceMedianMax: null,
};

/**
 * 메트릭을 조건에 대입해 통과 여부 계산.
 */
export function evaluateBatchFilter(
  metrics: FirstPageMetrics,
  cond: BatchFilterCondition,
): BatchFilterResult {
  const total = metrics.reviews.length;
  const belowReviewCount = metrics.reviews.filter(
    (r) => r.reviewCount < cond.reviewThreshold,
  ).length;
  const belowReviewRatio = total > 0 ? belowReviewCount / total : 0;

  const reviewPassed = belowReviewRatio >= cond.minBelowReviewRatio;

  let rocketPassed = true;
  if (cond.maxRocketRatio !== null && cond.maxRocketRatio !== undefined) {
    rocketPassed = metrics.rocketRatio <= cond.maxRocketRatio;
  }

  let pricePassed = true;
  const median = metrics.priceStats.median;
  if (cond.priceMedianMin !== null && cond.priceMedianMin !== undefined) {
    pricePassed = pricePassed && median !== null && median >= cond.priceMedianMin;
  }
  if (cond.priceMedianMax !== null && cond.priceMedianMax !== undefined) {
    pricePassed = pricePassed && median !== null && median <= cond.priceMedianMax;
  }

  const passed = reviewPassed && rocketPassed && pricePassed;

  let failReason: string | null = null;
  if (!passed) {
    const parts: string[] = [];
    if (!reviewPassed) {
      parts.push(
        `리뷰 ${cond.reviewThreshold}↓ ${Math.round(belowReviewRatio * 100)}% (기준 ${Math.round(cond.minBelowReviewRatio * 100)}%)`,
      );
    }
    if (!rocketPassed) {
      parts.push(
        `로켓 ${Math.round(metrics.rocketRatio * 100)}% (기준 ≤${Math.round((cond.maxRocketRatio ?? 0) * 100)}%)`,
      );
    }
    if (!pricePassed) {
      parts.push(
        `가격중앙 ${median !== null ? `₩${median.toLocaleString('ko-KR')}` : '없음'} (기준 ${cond.priceMedianMin ?? '?'}~${cond.priceMedianMax ?? '?'})`,
      );
    }
    failReason = parts.join(' / ');
  }

  return {
    passed,
    belowReviewCount,
    belowReviewRatio,
    checks: { reviewPassed, rocketPassed, pricePassed },
    failReason,
  };
}
