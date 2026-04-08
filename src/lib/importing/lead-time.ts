/**
 * 수입(Importing) 단계 — 견적 리드타임 평가 헬퍼 (G-3c)
 *
 * 출처: G-3 (G-1 /importing 대시보드 보강)
 * 헌법: CLAUDE.md §1 P-1 (계산 불가 시 'unknown' 명시),
 *       §1 P-9 (사용자 친화 — 지연 경고 한국어)
 *
 * 역할:
 * - 견적 확정일(decided_at)과 리드타임(lead_time_days)을 받아
 *   현재 시각 기준 "지연/임박/정상/평가불가"를 판정
 * - 순수 함수 — DB / I/O 의존 없음, 단위 테스트 가능
 *
 * 사용처:
 * - /importing 대시보드 카드 헤더 배지 + 정렬
 * - (향후) 알림 / 대시보드 위젯 등 재사용
 *
 * 상태 정의:
 * - 'overdue':  경과일 > 리드타임           (예: 14일 납기인데 16일 지남)
 * - 'soon':     남은 일수 ≤ 2일 (0 포함)    (예: 14일 납기, 12일 지남 → 남은 2일)
 * - 'ok':       남은 일수 > 2일              (아직 여유)
 * - 'unknown':  decided_at 또는 lead_time_days가 없거나 잘못된 값
 */

export type LeadTimeStatus = 'ok' | 'soon' | 'overdue' | 'unknown';

export interface LeadTimeEvaluation {
  status: LeadTimeStatus;
  /** 견적 확정일(decided_at)부터 now까지 경과 일수. unknown이면 null. */
  daysElapsed: number | null;
  /** 예상 도착까지 남은 일수 (음수 가능). unknown이면 null. */
  daysRemaining: number | null;
  /** overdue일 때만 채워짐 — 리드타임 초과 일수 (양수). */
  daysOverdue: number | null;
}

export interface LeadTimeInput {
  /** 견적 확정 시각 (acceptQuote 실행 시각). null이면 평가 불가. */
  decidedAt: Date | string | null;
  /** 견적서가 제시한 리드타임(일). null이면 평가 불가. */
  leadTimeDays: number | null;
}

const SOON_THRESHOLD_DAYS = 2;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;

const UNKNOWN_RESULT: LeadTimeEvaluation = {
  status: 'unknown',
  daysElapsed: null,
  daysRemaining: null,
  daysOverdue: null,
};

/**
 * 견적 확정일과 리드타임을 바탕으로 현재 지연 상태 평가.
 *
 * @param input  decidedAt + leadTimeDays
 * @param now    현재 시각 (테스트 주입용. 기본값: new Date())
 * @returns      LeadTimeEvaluation
 */
export function computeLeadTimeStatus(
  input: LeadTimeInput,
  now: Date = new Date(),
): LeadTimeEvaluation {
  if (input.decidedAt == null || input.leadTimeDays == null) {
    return UNKNOWN_RESULT;
  }
  if (!Number.isFinite(input.leadTimeDays) || input.leadTimeDays < 0) {
    return UNKNOWN_RESULT;
  }

  const decidedAtDate =
    input.decidedAt instanceof Date ? input.decidedAt : new Date(input.decidedAt);
  if (Number.isNaN(decidedAtDate.getTime())) {
    return UNKNOWN_RESULT;
  }

  const elapsed = Math.floor((now.getTime() - decidedAtDate.getTime()) / MS_PER_DAY);
  const remaining = input.leadTimeDays - elapsed;

  if (remaining < 0) {
    return {
      status: 'overdue',
      daysElapsed: elapsed,
      daysRemaining: remaining,
      daysOverdue: -remaining,
    };
  }

  if (remaining <= SOON_THRESHOLD_DAYS) {
    return {
      status: 'soon',
      daysElapsed: elapsed,
      daysRemaining: remaining,
      daysOverdue: null,
    };
  }

  return {
    status: 'ok',
    daysElapsed: elapsed,
    daysRemaining: remaining,
    daysOverdue: null,
  };
}

/**
 * 정렬용 우선순위 — 작을수록 먼저 노출.
 * overdue → soon → ok → unknown
 */
export const LEAD_TIME_SORT_ORDER: Record<LeadTimeStatus, number> = {
  overdue: 0,
  soon: 1,
  ok: 2,
  unknown: 3,
};
