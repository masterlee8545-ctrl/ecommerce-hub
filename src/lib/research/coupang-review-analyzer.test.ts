/**
 * 쿠팡 리뷰 분석기 단위 테스트
 *
 * 출처: src/lib/research/coupang-review-analyzer.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-3 (estimated 마킹)
 *
 * 검증 항목:
 * 1. AnalyzeInputSchema — 입력 길이 검증 (너무 짧음 / 너무 김 / 유효)
 * 2. AnalyzeResultSchema — 출력 스키마 검증 (필수 필드, confidence literal)
 * 3. CoupangReviewAnalyzerError — 생성자 + 단계 추적
 * 4. analyzeCoupangReviews — API 키 없을 때 config 단계 에러 throw
 *
 * 주의: 실제 Anthropic API를 호출하지 않는다 (비용 + 느림 + 외부 의존).
 * 호출 자체의 검증은 e2e 테스트(별도)에서 한다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AnalyzeInputSchema,
  AnalyzeResultSchema,
  CoupangReviewAnalyzerError,
  analyzeCoupangReviews,
} from './coupang-review-analyzer';

// ─────────────────────────────────────────────────────────
// 1. 입력 스키마
// ─────────────────────────────────────────────────────────

describe('AnalyzeInputSchema — 입력 검증', () => {
  it('유효한 입력 통과 (rawText만)', () => {
    const input = {
      rawText: '⭐⭐⭐⭐⭐ 정말 좋아요. 배송도 빨라서 만족합니다. 다음에도 또 살게요!',
    };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('유효한 입력 통과 (rawText + productHint)', () => {
    const input = {
      rawText: '⭐⭐⭐⭐⭐ 정말 좋아요. 배송도 빨라서 만족합니다. 다음에도 또 살게요!',
      productHint: '실리콘 주방 용품',
    };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rawText가 너무 짧으면 거부 (30자 미만)', () => {
    const input = { rawText: '좋아요' };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('최소');
    }
  });

  it('rawText가 너무 길면 거부 (8000자 초과)', () => {
    const TOO_LONG = 8001;
    const input = { rawText: 'a'.repeat(TOO_LONG) };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('최대');
    }
  });

  it('rawText가 정확히 30자면 통과 (경계)', () => {
    const EXACTLY_MIN = 30;
    const input = { rawText: 'a'.repeat(EXACTLY_MIN) };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rawText가 정확히 8000자면 통과 (경계)', () => {
    const EXACTLY_MAX = 8000;
    const input = { rawText: 'a'.repeat(EXACTLY_MAX) };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('productHint가 200자 초과면 거부', () => {
    const TOO_LONG = 201;
    const input = {
      rawText: '⭐⭐⭐⭐⭐ 정말 좋아요. 배송도 빨라서 만족합니다. 다음에도 또 살게요!',
      productHint: 'a'.repeat(TOO_LONG),
    };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rawText가 없으면 거부', () => {
    const input = { productHint: '주방 용품' };
    const result = AnalyzeInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// 2. 결과 스키마
// ─────────────────────────────────────────────────────────

describe('AnalyzeResultSchema — 출력 검증', () => {
  const validResult = {
    overallSummary: '대체로 만족도가 높지만 배송 지연 불만이 자주 보입니다.',
    topComplaints: [
      { text: '배송이 느리다', frequencyHint: 'high' as const },
      { text: '포장이 부실하다', frequencyHint: 'medium' as const, quote: '박스가 찌그러져서 왔어요' },
    ],
    topCompliments: [
      { text: '가성비가 좋다', frequencyHint: 'high' as const },
    ],
    suggestedDifferentiators: [
      '익일 배송 보장으로 차별화',
      '강화 포장재 적용',
    ],
    estimatedReviewCount: 36,
    confidence: 'estimated' as const,
  };

  it('완전한 결과 통과', () => {
    const result = AnalyzeResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it('빈 배열도 통과 (P-1: 빈 결과 명시 허용)', () => {
    const empty = {
      overallSummary: '리뷰가 너무 짧아 분석이 어렵습니다.',
      topComplaints: [],
      topCompliments: [],
      suggestedDifferentiators: [],
      estimatedReviewCount: 0,
      confidence: 'estimated' as const,
    };
    const result = AnalyzeResultSchema.safeParse(empty);
    expect(result.success).toBe(true);
  });

  it('confidence가 estimated가 아니면 거부 (P-3 강제)', () => {
    const wrong = { ...validResult, confidence: 'confirmed' as const };
    const result = AnalyzeResultSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('overallSummary가 비어 있으면 거부', () => {
    const wrong = { ...validResult, overallSummary: '' };
    const result = AnalyzeResultSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('frequencyHint가 잘못된 값이면 거부', () => {
    const wrong = {
      ...validResult,
      topComplaints: [{ text: '뭔가 별로', frequencyHint: 'sometimes' }],
    };
    const result = AnalyzeResultSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('topComplaints가 5개 초과면 거부', () => {
    const SIX = 6;
    const wrong = {
      ...validResult,
      topComplaints: Array.from({ length: SIX }, (_, i) => ({
        text: `불만 ${i}`,
        frequencyHint: 'low' as const,
      })),
    };
    const result = AnalyzeResultSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('estimatedReviewCount가 음수면 거부', () => {
    const wrong = { ...validResult, estimatedReviewCount: -1 };
    const result = AnalyzeResultSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// 3. 에러 클래스
// ─────────────────────────────────────────────────────────

describe('CoupangReviewAnalyzerError — 에러 클래스', () => {
  it('config 단계 에러 생성', () => {
    const err = new CoupangReviewAnalyzerError('API 키 없음', 'config');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CoupangReviewAnalyzerError);
    expect(err.stage).toBe('config');
    expect(err.name).toBe('CoupangReviewAnalyzerError');
    expect(err.message).toContain('API 키 없음');
  });

  it('parse 단계 에러는 cause를 보존', () => {
    const cause = new Error('원본 zod 에러');
    const err = new CoupangReviewAnalyzerError('스키마 불일치', 'parse', cause);
    expect(err.stage).toBe('parse');
    expect(err.cause).toBe(cause);
  });

  it('cause 없이도 동작', () => {
    const err = new CoupangReviewAnalyzerError('단순 에러', 'api');
    expect(err.stage).toBe('api');
    expect(err.cause).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// 4. analyzeCoupangReviews — config 단계 실패 케이스
// ─────────────────────────────────────────────────────────

describe('analyzeCoupangReviews — 환경변수 누락', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = savedKey;
    }
  });

  it('ANTHROPIC_API_KEY가 없으면 config 단계 에러 throw', async () => {
    const input = {
      rawText: '⭐⭐⭐⭐⭐ 정말 좋아요. 배송도 빨라서 만족합니다. 다음에도 또 살게요!',
    };
    await expect(analyzeCoupangReviews(input)).rejects.toThrow(CoupangReviewAnalyzerError);
    await expect(analyzeCoupangReviews(input)).rejects.toMatchObject({
      stage: 'config',
    });
  });
});
