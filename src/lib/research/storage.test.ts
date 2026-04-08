/**
 * 분석 저장/조회 라이브러리 단위 테스트
 *
 * 출처: src/lib/research/storage.ts (D-1b)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-3 (estimated 강제)
 *
 * 검증 항목:
 * 1. saveAnalysis — 입력 검증 (companyId/rawText/model/confidence)
 * 2. listRecentAnalyses — companyId 누락 시 throw
 * 3. getAnalysisById — 둘 중 하나 누락 시 throw
 *
 * 주의: 실제 DB를 호출하지 않는다. 검증 분기만 확인.
 */
import { describe, expect, it } from 'vitest';

import { getAnalysisById, listRecentAnalyses, saveAnalysis } from './storage';

import type { AnalyzeResult } from './coupang-review-analyzer';

// ─────────────────────────────────────────────────────────
// 더미 입력
// ─────────────────────────────────────────────────────────

const validResult: AnalyzeResult = {
  overallSummary: '대체로 좋은 평가입니다.',
  topComplaints: [{ text: '배송 느림', frequencyHint: 'medium' }],
  topCompliments: [{ text: '가성비 좋음', frequencyHint: 'high' }],
  suggestedDifferentiators: ['익일 배송'],
  estimatedReviewCount: 50,
  confidence: 'estimated',
};

const baseInput = {
  companyId: '00000000-0000-0000-0000-000000000001',
  rawText: '⭐⭐⭐⭐⭐ 정말 좋아요. 배송도 빨라서 만족합니다. 다음에도 또 살게요!',
  model: 'claude-opus-4-5',
  result: validResult,
};

// ─────────────────────────────────────────────────────────
// 1. saveAnalysis — 입력 검증
// ─────────────────────────────────────────────────────────

describe('saveAnalysis — 입력 검증 (DB 호출 전)', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(saveAnalysis({ ...baseInput, companyId: '' })).rejects.toThrow('companyId');
  });

  it('rawText 빈 문자열이면 throw', async () => {
    await expect(saveAnalysis({ ...baseInput, rawText: '' })).rejects.toThrow('rawText');
  });

  it('model 빈 문자열이면 throw', async () => {
    await expect(saveAnalysis({ ...baseInput, model: '' })).rejects.toThrow('model');
  });

  it('confidence가 estimated가 아니면 throw (P-3 강제)', async () => {
    const wrongResult: AnalyzeResult = {
      ...validResult,
      // @ts-expect-error - 의도적인 P-3 위반 시도
      confidence: 'confirmed',
    };
    await expect(
      saveAnalysis({ ...baseInput, result: wrongResult }),
    ).rejects.toThrow('estimated');
  });

  it('createdBy null도 통과 (검증 단계까지는)', async () => {
    // 입력 검증을 통과하면 다음 단계로 진입 (DB 단에서 실패해도 무방)
    try {
      await saveAnalysis({ ...baseInput, createdBy: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 검증 메시지는 안 나와야 함
      expect(msg).not.toContain('companyId가 필요');
      expect(msg).not.toContain('rawText가 비어');
      expect(msg).not.toContain('model이 비어');
      expect(msg).not.toContain('confidence는 반드시');
    }
  });
});

// ─────────────────────────────────────────────────────────
// 2. listRecentAnalyses — 입력 검증
// ─────────────────────────────────────────────────────────

describe('listRecentAnalyses — 입력 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(listRecentAnalyses({ companyId: '' })).rejects.toThrow('companyId');
  });
});

// ─────────────────────────────────────────────────────────
// 3. getAnalysisById — 입력 검증
// ─────────────────────────────────────────────────────────

describe('getAnalysisById — 입력 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(getAnalysisById('', 'some-id')).rejects.toThrow();
  });

  it('analysisId 누락 시 throw', async () => {
    await expect(getAnalysisById('some-company-id', '')).rejects.toThrow();
  });
});
