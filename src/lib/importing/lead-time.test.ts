/**
 * computeLeadTimeStatus — 단위 테스트 (G-3c)
 *
 * 출처: src/lib/importing/lead-time.ts
 * 헌법: CLAUDE.md §1 P-1 (계산 불가 시 unknown 명시),
 *       §1 P-2 (잘못된 입력 → 조용한 unknown, throw 안 함 — 표시 함수이므로)
 *
 * 주의: now를 명시 주입해서 시간 의존 테스트를 결정론적으로 만든다.
 */
import { describe, expect, it } from 'vitest';

import { LEAD_TIME_SORT_ORDER, computeLeadTimeStatus } from './lead-time';

// 모든 테스트의 기준 "현재 시각" — 2026-04-08 12:00 UTC
const NOW = new Date('2026-04-08T12:00:00Z');

describe('computeLeadTimeStatus — 입력 검증 (unknown 케이스)', () => {
  it('decidedAt이 null이면 unknown', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: null, leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('unknown');
    expect(result.daysElapsed).toBeNull();
    expect(result.daysRemaining).toBeNull();
    expect(result.daysOverdue).toBeNull();
  });

  it('leadTimeDays가 null이면 unknown', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-04-01'), leadTimeDays: null },
      NOW,
    );
    expect(result.status).toBe('unknown');
  });

  it('leadTimeDays가 음수면 unknown (잘못된 데이터)', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-04-01'), leadTimeDays: -5 },
      NOW,
    );
    expect(result.status).toBe('unknown');
  });

  it('leadTimeDays가 NaN이면 unknown', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-04-01'), leadTimeDays: Number.NaN },
      NOW,
    );
    expect(result.status).toBe('unknown');
  });

  it('잘못된 날짜 문자열이면 unknown', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: 'not-a-date', leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('unknown');
  });
});

describe('computeLeadTimeStatus — 정상 (ok) 케이스', () => {
  it('충분히 여유로우면 ok — 4월 1일 확정, 14일 납기, 오늘 4월 8일', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-04-01T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('ok');
    expect(result.daysElapsed).toBe(7);
    expect(result.daysRemaining).toBe(7);
    expect(result.daysOverdue).toBeNull();
  });

  it('남은 일수가 3일이면 아직 ok (soon은 ≤2일부터)', () => {
    // 3월 28일 확정, 14일 납기 → 경과 11, 남은 3
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-28T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('ok');
    expect(result.daysRemaining).toBe(3);
  });

  it('문자열 decidedAt도 허용 (Drizzle decimal/text 호환)', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: '2026-04-01T00:00:00Z', leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('ok');
    expect(result.daysElapsed).toBe(7);
  });
});

describe('computeLeadTimeStatus — 임박 (soon) 케이스', () => {
  it('남은 일수가 2일이면 soon', () => {
    // 3월 27일 확정, 14일 납기 → 경과 12, 남은 2
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-27T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('soon');
    expect(result.daysElapsed).toBe(12);
    expect(result.daysRemaining).toBe(2);
    expect(result.daysOverdue).toBeNull();
  });

  it('남은 일수가 1일이면 soon', () => {
    // 3월 26일 확정, 14일 납기 → 경과 13, 남은 1
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-26T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('soon');
    expect(result.daysRemaining).toBe(1);
  });

  it('딱 납기 당일이면 soon (남은 0)', () => {
    // 3월 25일 확정, 14일 납기 → 경과 14, 남은 0
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-25T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('soon');
    expect(result.daysRemaining).toBe(0);
  });
});

describe('computeLeadTimeStatus — 지연 (overdue) 케이스', () => {
  it('납기 1일 초과면 overdue (daysOverdue=1)', () => {
    // 3월 24일 확정, 14일 납기 → 경과 15, 남은 -1
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-24T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('overdue');
    expect(result.daysElapsed).toBe(15);
    expect(result.daysRemaining).toBe(-1);
    expect(result.daysOverdue).toBe(1);
  });

  it('납기 7일 초과면 overdue (daysOverdue=7)', () => {
    // 3월 18일 확정, 14일 납기 → 경과 21, 남은 -7
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-03-18T00:00:00Z'), leadTimeDays: 14 },
      NOW,
    );
    expect(result.status).toBe('overdue');
    expect(result.daysOverdue).toBe(7);
  });

  it('납기 0일 + 어제 확정 → overdue (즉납인데 하루 지남)', () => {
    const result = computeLeadTimeStatus(
      { decidedAt: new Date('2026-04-07T00:00:00Z'), leadTimeDays: 0 },
      NOW,
    );
    expect(result.status).toBe('overdue');
    expect(result.daysOverdue).toBe(1);
  });
});

describe('LEAD_TIME_SORT_ORDER — 정렬 우선순위', () => {
  it('overdue가 가장 앞', () => {
    expect(LEAD_TIME_SORT_ORDER.overdue).toBeLessThan(LEAD_TIME_SORT_ORDER.soon);
    expect(LEAD_TIME_SORT_ORDER.overdue).toBeLessThan(LEAD_TIME_SORT_ORDER.ok);
    expect(LEAD_TIME_SORT_ORDER.overdue).toBeLessThan(LEAD_TIME_SORT_ORDER.unknown);
  });

  it('soon이 ok보다 앞', () => {
    expect(LEAD_TIME_SORT_ORDER.soon).toBeLessThan(LEAD_TIME_SORT_ORDER.ok);
  });

  it('unknown이 가장 뒤', () => {
    expect(LEAD_TIME_SORT_ORDER.unknown).toBeGreaterThan(LEAD_TIME_SORT_ORDER.ok);
  });
});
