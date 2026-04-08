/**
 * 소싱 Server Actions 단위 테스트 (G-3a)
 *
 * 출처: src/lib/sourcing/actions.ts (updateQuoteStatusAction)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-9 (사용자 친화 한국어)
 *
 * 검증 범위:
 * - updateQuoteStatusAction 입력 검증 (form 파싱 → throw 분기)
 *   * 빈 quoteId → throw
 *   * 유효하지 않은 status → throw
 *   * accepted로의 전환 차단 (acceptQuoteAction 전용)
 *
 * 주의:
 * - 이 테스트는 검증 분기에서 throw되는 경로만 다룬다.
 *   (requireCompanyContext / DB 호출 단계는 통합 테스트 영역)
 * - 모든 유효 분기는 quotes.test.ts의 updateQuote 검증으로 이미 커버됨.
 *
 * 모듈 모킹:
 * - vitest 환경에서 next-auth는 next/server를 ESM 형태로 import 시 해석에 실패한다.
 *   actions.ts가 @/lib/auth/session을 거쳐 next-auth를 끌어오므로 세션 모듈을
 *   가벼운 stub으로 대체해 모듈 그래프를 차단한다.
 * - revalidatePath / redirect도 이 테스트에서는 호출되지 않아야 하므로 stub.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  requireCompanyContext: vi.fn(async () => {
    throw new Error('TEST: requireCompanyContext should not be called in validation tests');
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('TEST: redirect should not be called in validation tests');
  }),
}));

import { updateQuoteStatusAction } from './actions';

// ─────────────────────────────────────────────────────────
// 헬퍼 — FormData 생성
// ─────────────────────────────────────────────────────────

const FAKE_QUOTE_ID = '00000000-0000-0000-0000-000000000004';
const FAKE_PRODUCT_ID = '00000000-0000-0000-0000-000000000002';

function buildForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

// ─────────────────────────────────────────────────────────
// updateQuoteStatusAction — 입력 검증
// ─────────────────────────────────────────────────────────

describe('updateQuoteStatusAction — 입력 검증', () => {
  it('quoteId가 비어있으면 한국어 에러 throw', async () => {
    const form = buildForm({
      quoteId: '',
      status: 'received',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow('견적 ID가 없습니다.');
  });

  it('quoteId가 공백만 있으면 throw (trim 적용)', async () => {
    const form = buildForm({
      quoteId: '   ',
      status: 'received',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow('견적 ID가 없습니다.');
  });

  it('status가 유효하지 않으면 throw (한국어 메시지에 입력값 노출)', async () => {
    const form = buildForm({
      quoteId: FAKE_QUOTE_ID,
      status: 'invalid_status',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow(
      '유효하지 않은 상태값입니다',
    );
    await expect(updateQuoteStatusAction(form)).rejects.toThrow('invalid_status');
  });

  it('status가 비어있으면 throw (빈 문자열도 유효 상태가 아님)', async () => {
    const form = buildForm({
      quoteId: FAKE_QUOTE_ID,
      status: '',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow(
      '유효하지 않은 상태값입니다',
    );
  });

  it('accepted 상태로의 전환은 차단 (acceptQuoteAction 안내 메시지)', async () => {
    const form = buildForm({
      quoteId: FAKE_QUOTE_ID,
      status: 'accepted',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow('acceptQuoteAction');
  });

  it('accepted 차단 메시지에 "이 견적으로 발주" 안내 포함 (P-9)', async () => {
    const form = buildForm({
      quoteId: FAKE_QUOTE_ID,
      status: 'accepted',
      productId: FAKE_PRODUCT_ID,
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow('이 견적으로 발주');
  });

  it('productId가 누락되어도 status 유효성 검증은 그대로 동작', async () => {
    // productId는 revalidatePath용 옵셔널 필드 — 누락이어도 검증 단계는 진행
    const form = buildForm({
      quoteId: FAKE_QUOTE_ID,
      status: 'invalid_status',
    });
    await expect(updateQuoteStatusAction(form)).rejects.toThrow(
      '유효하지 않은 상태값입니다',
    );
  });
});
