/**
 * 상품(products) 도메인 단위 테스트 — 라이브러리 + 전이
 *
 * 출처: src/lib/products/{constants,queries,mutations,transitions}.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-3 (estimated 강제),
 *       §1 P-4 (멀티테넌트)
 *
 * 검증 항목:
 * 1. 상수 무결성 (PIPELINE_STAGES 6단계, NEXT_STAGES, TASK_TYPES 15종)
 * 2. buildTransitionIdempotencyKey — ADR-005 멱등 키 형식
 * 3. parsePipelineStageFilter — URL 쿼리 파싱
 * 4. createProduct — 입력 검증
 * 5. updateProduct — 입력 검증
 * 6. transitionProductStatus — 입력 검증 (전이 규칙 + 사유 길이)
 *
 * 주의: DB 호출 부분은 검증 직후 멈춤. 실제 INSERT/UPDATE는 통합 테스트로.
 */
import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_LEVELS,
  NEXT_STAGES,
  PIPELINE_STAGES,
  TASK_TYPES,
  TRANSITION_TASK_MAP,
  buildTransitionIdempotencyKey,
  type PipelineStage,
} from './constants';
import { createProduct, updateProduct } from './mutations';
import { parsePipelineStageFilter } from './queries';
import { transitionProductStatus } from './transitions';

const FAKE_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_PRODUCT_ID = '00000000-0000-0000-0000-000000000002';

// ─────────────────────────────────────────────────────────
// 1. 상수 무결성
// ─────────────────────────────────────────────────────────

describe('PIPELINE_STAGES — 6단계 무결성', () => {
  it('6단계 정의됨', () => {
    const EXPECTED_COUNT = 6;
    expect(PIPELINE_STAGES).toHaveLength(EXPECTED_COUNT);
  });

  it('research → branding 순서로 정의', () => {
    expect(PIPELINE_STAGES[0]).toBe('research');
    const LAST_INDEX = 5;
    expect(PIPELINE_STAGES[LAST_INDEX]).toBe('branding');
  });

  it('모든 단계가 NEXT_STAGES에 매핑됨', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(NEXT_STAGES[stage]).toBeDefined();
    }
  });

  it('branding은 최종 단계 — 다음 없음', () => {
    expect(NEXT_STAGES.branding).toEqual([]);
  });

  it('각 단계는 최대 1개의 다음 단계만 가짐 (직진형)', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(NEXT_STAGES[stage].length).toBeLessThanOrEqual(1);
    }
  });
});

describe('CONFIDENCE_LEVELS — 신뢰도 3종', () => {
  it('confirmed/estimated/unknown 정의', () => {
    const EXPECTED_COUNT = 3;
    expect(CONFIDENCE_LEVELS).toHaveLength(EXPECTED_COUNT);
    expect(CONFIDENCE_LEVELS).toContain('confirmed');
    expect(CONFIDENCE_LEVELS).toContain('estimated');
    expect(CONFIDENCE_LEVELS).toContain('unknown');
  });
});

describe('TASK_TYPES — 15종 task 정의 (SPEC §7)', () => {
  it('정확히 15종', () => {
    const EXPECTED_COUNT = 15;
    expect(TASK_TYPES).toHaveLength(EXPECTED_COUNT);
  });
});

describe('TRANSITION_TASK_MAP — 5개 전이 매핑', () => {
  it('5개 전이 정의 (research:sourcing ~ active:branding)', () => {
    const EXPECTED_COUNT = 5;
    expect(Object.keys(TRANSITION_TASK_MAP)).toHaveLength(EXPECTED_COUNT);
  });

  it('research:sourcing은 1688 견적 의뢰 task 1개', () => {
    const tasks = TRANSITION_TASK_MAP['research:sourcing'];
    expect(tasks).toBeDefined();
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0]?.taskType).toBe('quote_request_1688');
  });

  it('importing:listing은 4종 task (디자인/촬영/SEO/광고)', () => {
    const tasks = TRANSITION_TASK_MAP['importing:listing'];
    const EXPECTED = 4;
    expect(tasks).toHaveLength(EXPECTED);
  });

  it('모든 매핑된 task_type은 TASK_TYPES에 존재', () => {
    for (const tasks of Object.values(TRANSITION_TASK_MAP)) {
      for (const t of tasks) {
        expect(TASK_TYPES).toContain(t.taskType);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────
// 2. buildTransitionIdempotencyKey — ADR-005
// ─────────────────────────────────────────────────────────

describe('buildTransitionIdempotencyKey — ADR-005 멱등 키', () => {
  it('형식: transition:{productId}:{from}:{to}:{taskType}', () => {
    const key = buildTransitionIdempotencyKey(
      'prod-123',
      'research',
      'sourcing',
      'quote_request_1688',
    );
    expect(key).toBe('transition:prod-123:research:sourcing:quote_request_1688');
  });

  it('같은 입력은 항상 같은 키 생성 (멱등성)', () => {
    const k1 = buildTransitionIdempotencyKey('p1', 'sourcing', 'importing', 'payment_confirm');
    const k2 = buildTransitionIdempotencyKey('p1', 'sourcing', 'importing', 'payment_confirm');
    expect(k1).toBe(k2);
  });

  it('다른 productId면 다른 키', () => {
    const k1 = buildTransitionIdempotencyKey('p1', 'research', 'sourcing', 'quote_request_1688');
    const k2 = buildTransitionIdempotencyKey('p2', 'research', 'sourcing', 'quote_request_1688');
    expect(k1).not.toBe(k2);
  });
});

// ─────────────────────────────────────────────────────────
// 3. parsePipelineStageFilter — URL 쿼리 파싱
// ─────────────────────────────────────────────────────────

describe('parsePipelineStageFilter — URL 쿼리 파싱', () => {
  it('null → 빈 배열', () => {
    expect(parsePipelineStageFilter(null)).toEqual([]);
  });

  it('undefined → 빈 배열', () => {
    expect(parsePipelineStageFilter(undefined)).toEqual([]);
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(parsePipelineStageFilter('')).toEqual([]);
  });

  it('단일 값 파싱', () => {
    expect(parsePipelineStageFilter('research')).toEqual(['research']);
  });

  it('콤마 구분 다중 값 파싱', () => {
    const result = parsePipelineStageFilter('research,sourcing,importing');
    expect(result).toEqual(['research', 'sourcing', 'importing']);
  });

  it('잘못된 값은 조용히 무시', () => {
    const result = parsePipelineStageFilter('research,invalid,sourcing');
    expect(result).toEqual(['research', 'sourcing']);
  });

  it('공백은 trim', () => {
    const result = parsePipelineStageFilter(' research , sourcing ');
    expect(result).toEqual(['research', 'sourcing']);
  });
});

// ─────────────────────────────────────────────────────────
// 4. createProduct — 입력 검증
// ─────────────────────────────────────────────────────────

describe('createProduct — 입력 검증', () => {
  const baseInput = {
    companyId: FAKE_COMPANY_ID,
    code: 'PROD-2026-0001',
    name: '수입 마늘 다지기',
  };

  it('companyId 누락 시 throw', async () => {
    await expect(createProduct({ ...baseInput, companyId: '' })).rejects.toThrow('companyId');
  });

  it('이름이 빈 문자열이면 throw', async () => {
    await expect(createProduct({ ...baseInput, name: '' })).rejects.toThrow('이름이 비어');
  });

  it('이름이 공백만이면 throw', async () => {
    await expect(createProduct({ ...baseInput, name: '   ' })).rejects.toThrow('이름이 비어');
  });

  it('이름 200자 초과면 throw', async () => {
    const TOO_LONG = 201;
    await expect(createProduct({ ...baseInput, name: 'a'.repeat(TOO_LONG) })).rejects.toThrow(
      '너무 깁니다',
    );
  });

  it('코드가 빈 문자열이면 throw', async () => {
    await expect(createProduct({ ...baseInput, code: '' })).rejects.toThrow('코드가 비어');
  });

  it('코드 50자 초과면 throw', async () => {
    const TOO_LONG = 51;
    await expect(createProduct({ ...baseInput, code: 'A'.repeat(TOO_LONG) })).rejects.toThrow(
      '너무 깁니다',
    );
  });

  it('잘못된 confidence 값이면 throw', async () => {
    await expect(
      createProduct({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        cogsCnyConfidence: 'invalid',
      }),
    ).rejects.toThrow('cogs_cny_confidence');
  });
});

// ─────────────────────────────────────────────────────────
// 5. updateProduct — 입력 검증
// ─────────────────────────────────────────────────────────

describe('updateProduct — 입력 검증', () => {
  const baseInput = {
    companyId: FAKE_COMPANY_ID,
    productId: FAKE_PRODUCT_ID,
  };

  it('companyId 누락 시 throw', async () => {
    await expect(updateProduct({ ...baseInput, companyId: '' })).rejects.toThrow('companyId');
  });

  it('productId 누락 시 throw', async () => {
    await expect(updateProduct({ ...baseInput, productId: '' })).rejects.toThrow('productId');
  });

  it('이름 변경 시 빈 문자열이면 throw', async () => {
    await expect(updateProduct({ ...baseInput, name: '' })).rejects.toThrow('이름이 비어');
  });

  it('잘못된 marginRateConfidence면 throw', async () => {
    await expect(
      updateProduct({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        marginRateConfidence: 'wrong',
      }),
    ).rejects.toThrow('margin_rate_confidence');
  });
});

// ─────────────────────────────────────────────────────────
// 6. transitionProductStatus — 입력 검증
// ─────────────────────────────────────────────────────────

describe('transitionProductStatus — 입력 검증', () => {
  const baseInput = {
    companyId: FAKE_COMPANY_ID,
    productId: FAKE_PRODUCT_ID,
    toStatus: 'sourcing' as PipelineStage,
  };

  it('companyId 누락 시 throw', async () => {
    await expect(
      transitionProductStatus({ ...baseInput, companyId: '' }),
    ).rejects.toThrow('companyId');
  });

  it('productId 누락 시 throw', async () => {
    await expect(
      transitionProductStatus({ ...baseInput, productId: '' }),
    ).rejects.toThrow('productId');
  });

  it('toStatus가 잘못된 값이면 throw', async () => {
    await expect(
      transitionProductStatus({
        ...baseInput,
        // @ts-expect-error - 의도적인 잘못된 값
        toStatus: 'invalid',
      }),
    ).rejects.toThrow('유효하지 않은 단계');
  });

  it('사유가 500자 초과면 throw', async () => {
    const TOO_LONG = 501;
    await expect(
      transitionProductStatus({ ...baseInput, reason: 'a'.repeat(TOO_LONG) }),
    ).rejects.toThrow('너무 깁니다');
  });
});
