/**
 * 시즌 분석 엔진. BUYWISE Python analyzer.py 의 TypeScript 포팅.
 *
 * 입력: 셀록홈즈 chart API 의 일별 ratio 배열.
 * 처리: 일별 → 월별 평균 → 피크/상승/준비월 자동 산출 → 5점 스코어링.
 *
 * 핵심 산출:
 * - peak_month     : 월별 평균 ratio 최고 달
 * - rise_month     : 피크 6개월 전부터 가장 큰 비율 점프 (1.3배+)
 * - prep_month     : rise_month - 1 (지금 준비 시작!)
 * - decline_month  : 피크 후 50% 이하 도달 시점
 * - demand_period  : 피크 30%+ 유지 구간 ("8월~10월")
 * - seasonality_ratio : 피크 / 바닥 6개월 평균
 * - is_evergreen   : 변동 < 2x 면 상시 상품
 *
 * 형 공식: 5점/4점/2점 시즌 스코어링.
 *
 * 출처: C:\개발\sellochomes-sourcing\analyzer.py (Python에서 검증 완료)
 */
import type { SCChartDataPoint } from './client';

export const MONTH_NAMES = [
  '',
  '1월',
  '2월',
  '3월',
  '4월',
  '5월',
  '6월',
  '7월',
  '8월',
  '9월',
  '10월',
  '11월',
  '12월',
];

export const MIN_NONZERO_MONTHS = 6;
export const DEFAULT_SURGE_MULT = 2.0;

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export type DataQuality = '부족' | '보통' | '충분';

export interface MonthlyAverages {
  /** 월(1~12) → 그 달의 평균 ratio */
  [month: number]: number;
}

export interface KeywordSeasonAnalysis {
  keyword: string;
  /** 월별 평균 ratio (분석 윈도우 내) */
  monthlyAverages: MonthlyAverages;
  /** 월별 키 개별 접근용 — m1, m2, ..., m12 */
  m1: number;
  m2: number;
  m3: number;
  m4: number;
  m5: number;
  m6: number;
  m7: number;
  m8: number;
  m9: number;
  m10: number;
  m11: number;
  m12: number;
  peak_month: number;
  rise_month: number;
  prep_month: number;
  decline_month: number;
  demand_period: string;
  sustained_months: number;
  nonzero_months: number;
  data_quality: DataQuality;
  pre_season_avg: number;
  peak_ratio: number;
  seasonality_ratio: number;
  is_evergreen: boolean;
  recent_30d_avg: number;
  data_start: string; // 'YYYY-MM-DD'
  data_end: string;
  total_points: number;
  /** 분석에 사용된 윈도우 — 'last_year' | 'last_2_years' | 'all' */
  analysis_window: AnalysisWindow;
}

export type AnalysisWindow = 'last_year' | 'last_2_years' | 'all';

export interface MonthRelevance {
  /** 0~5 점 (0이면 해당월에 추천하지 않음) */
  score: number;
  reason: string;
  caution: string;
}

export interface AnalyzeOptions {
  /** 분석에 사용할 데이터 윈도우 (기본 'last_year' — 형 요청). */
  window?: AnalysisWindow;
  /** 시즌 vs 상시 판단 임계 (기본 2.0배) */
  surgeMult?: number;
  /** 분석 기준 시점 (기본: 데이터의 가장 최근 날짜). 테스트 편의용. */
  asOf?: Date;
}

// ─────────────────────────────────────────────────────────
// 메인 — 한 키워드 분석
// ─────────────────────────────────────────────────────────

/**
 * 일별 데이터 배열을 받아 시즌 분석 결과 반환.
 * 데이터 비어있으면 null.
 */
export function analyzeKeyword(
  keyword: string,
  dailyData: SCChartDataPoint[],
  options: AnalyzeOptions = {},
): KeywordSeasonAnalysis | null {
  if (!dailyData || dailyData.length === 0) return null;

  const window = options.window ?? 'last_year';
  const surgeMult = options.surgeMult ?? DEFAULT_SURGE_MULT;

  // 분석 윈도우로 필터링
  const sorted = [...dailyData].sort((a, b) => a.period.localeCompare(b.period));
  const dataEndStr = sorted[sorted.length - 1]?.period ?? '';
  const asOf = options.asOf ?? (dataEndStr ? new Date(dataEndStr) : new Date());

  const filtered = filterWindow(sorted, window, asOf);
  if (filtered.length === 0) return null;

  // 월별 평균 (1~12월)
  const monthlyAvg = computeMonthlyAverages(filtered);

  // 데이터 품질
  const nonzeroMonths = Object.values(monthlyAvg).filter((v) => v > 0).length;
  let dataQuality: DataQuality;
  if (nonzeroMonths < MIN_NONZERO_MONTHS) dataQuality = '부족';
  else if (nonzeroMonths < 9) dataQuality = '보통';
  else dataQuality = '충분';

  // 시즌성 비율 (피크 / 바닥 6개월 평균)
  const sortedVals = Object.values(monthlyAvg).sort((a, b) => a - b);
  const preSeasonAvg = sortedVals.slice(0, 6).reduce((s, v) => s + v, 0) / 6;
  const peakRatio = Math.max(...Object.values(monthlyAvg));
  const seasonalityRatio = preSeasonAvg > 0 ? peakRatio / preSeasonAvg : 999;

  const isEvergreen = seasonalityRatio < surgeMult;

  // 변곡점 산출
  const peakMonth = peakRatio > 0 ? findPeakMonth(monthlyAvg) : 0;
  const surgeThreshold = preSeasonAvg > 0 ? preSeasonAvg * surgeMult : peakRatio * 0.3;
  const riseMonth = findRiseMonth(monthlyAvg, peakMonth);
  const prepMonth = riseMonth > 0 ? ((riseMonth - 2 + 12) % 12) + 1 : 0;
  const declineMonth = findDeclineMonth(monthlyAvg, peakMonth);

  // 수요 기간 (피크 30%+ 유지 구간)
  const demandPeriod = getDemandPeriod(monthlyAvg, peakMonth);

  // 수요 유지 개월 수 (surge_threshold 이상)
  const sustainedMonths = Object.values(monthlyAvg).filter((v) => v >= surgeThreshold).length;

  // 최근 30일 평균
  const recentCutoff = new Date(asOf);
  recentCutoff.setDate(recentCutoff.getDate() - 30);
  const recent30 = filtered.filter((d) => new Date(d.period) >= recentCutoff);
  const recent30dAvg =
    recent30.length > 0
      ? recent30.reduce((s, d) => s + d.ratio, 0) / recent30.length
      : 0;

  return {
    keyword,
    monthlyAverages: monthlyAvg,
    m1: round2(monthlyAvg[1] ?? 0),
    m2: round2(monthlyAvg[2] ?? 0),
    m3: round2(monthlyAvg[3] ?? 0),
    m4: round2(monthlyAvg[4] ?? 0),
    m5: round2(monthlyAvg[5] ?? 0),
    m6: round2(monthlyAvg[6] ?? 0),
    m7: round2(monthlyAvg[7] ?? 0),
    m8: round2(monthlyAvg[8] ?? 0),
    m9: round2(monthlyAvg[9] ?? 0),
    m10: round2(monthlyAvg[10] ?? 0),
    m11: round2(monthlyAvg[11] ?? 0),
    m12: round2(monthlyAvg[12] ?? 0),
    peak_month: peakMonth,
    rise_month: riseMonth,
    prep_month: prepMonth,
    decline_month: declineMonth,
    demand_period: demandPeriod,
    sustained_months: sustainedMonths,
    nonzero_months: nonzeroMonths,
    data_quality: dataQuality,
    pre_season_avg: round2(preSeasonAvg),
    peak_ratio: round2(peakRatio),
    seasonality_ratio: round2(seasonalityRatio),
    is_evergreen: isEvergreen,
    recent_30d_avg: round2(recent30dAvg),
    data_start: filtered[0]?.period ?? '',
    data_end: filtered[filtered.length - 1]?.period ?? '',
    total_points: filtered.length,
    analysis_window: window,
  };
}

// ─────────────────────────────────────────────────────────
// 5점 스코어링 (형 공식)
// ─────────────────────────────────────────────────────────

/**
 * target 월에 키워드의 관련성 점수.
 *
 * 5점: prep_month = target — 지금 준비 시작!
 * 4점: rise_month = target — 이번 달부터 급상승
 * 2점: peak_month - 1 = target — 다음 달 피크
 * 1점: 상승 구간 중 (rise~peak 사이, 전월 대비 상승)
 * 0점: 하락 중 / prep~peak 범위 밖 → 추천 X
 */
export function getMonthRelevance(
  analysis: KeywordSeasonAnalysis,
  targetMonth: number,
): MonthRelevance {
  const peak = analysis.peak_month;
  const rise = analysis.rise_month;
  const prep = analysis.prep_month;

  // 1) 하락 중이면 즉시 0점
  if (isDecliningAt(analysis, targetMonth)) {
    return { score: 0, reason: '', caution: '-' };
  }
  // 2) prep~peak 범위 밖이면 추천 X
  if (!monthInRange(targetMonth, prep, peak)) {
    return { score: 0, reason: '', caution: '-' };
  }

  let score = 0;
  const parts: string[] = [];

  // 5점 — 준비월
  if (prep === targetMonth) {
    score += 5;
    parts.push(`다음 달(${MONTH_NAMES[rise]})부터 검색량이 크게 오릅니다. 지금 준비!`);
  }
  // 4점 — 상승월
  if (rise === targetMonth) {
    score += 4;
    parts.push(`이번 달부터 검색량이 크게 오릅니다 (${analysis.demand_period})`);
  }
  // 2점 — 피크 직전월
  const prevPeak = peak > 1 ? peak - 1 : 12;
  if (targetMonth === prevPeak && targetMonth !== prep && targetMonth !== rise) {
    score += 2;
    parts.push(`다음 달(${MONTH_NAMES[peak]})이 검색량 최고점`);
  }
  // 1점 — 상승 구간 중
  if (score === 0 && monthInRange(targetMonth, rise, peak)) {
    const cur = monthValue(analysis, targetMonth);
    const prevM = ((targetMonth - 2 + 12) % 12) + 1;
    const prev = monthValue(analysis, prevM);
    if (cur > prev) {
      score += 1;
      parts.push(`검색량 상승 중 (${analysis.demand_period})`);
    }
  }
  if (score > 0) {
    parts.push(`시즌성 ${analysis.seasonality_ratio.toFixed(1)}배`);
  }

  const cautions: string[] = [];
  if (analysis.data_quality === '부족') {
    cautions.push(`데이터 부족 (비제로 ${analysis.nonzero_months}/12개월)`);
  }
  if (analysis.peak_ratio < 5) {
    cautions.push('피크 ratio < 5 — 시장 작을 수 있음');
  }

  return {
    score,
    reason: parts.join(' / '),
    caution: cautions.length > 0 ? cautions.join(' / ') : '-',
  };
}

// ─────────────────────────────────────────────────────────
// 유틸 — 작년 12개월 그래프용 (단독 사용 가능)
// ─────────────────────────────────────────────────────────

/**
 * "작년 12개월" 막대그래프용 데이터 산출.
 * asOf 기준 최근 1년 (365일) 데이터를 월별 평균으로 집계.
 * 비어있는 달은 0.
 */
export function buildLastYearMonthlyChart(
  dailyData: SCChartDataPoint[],
  asOf: Date = new Date(),
): Array<{ month: number; label: string; ratio: number }> {
  const filtered = filterWindow(dailyData, 'last_year', asOf);
  const monthlyAvg = computeMonthlyAverages(filtered);
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return {
      month: m,
      label: MONTH_NAMES[m] ?? `${m}월`,
      ratio: round2(monthlyAvg[m] ?? 0),
    };
  });
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

function filterWindow(
  data: SCChartDataPoint[],
  window: AnalysisWindow,
  asOf: Date,
): SCChartDataPoint[] {
  if (window === 'all') return data;
  const days = window === 'last_year' ? 365 : 730;
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return data.filter((d) => d.period >= cutoffStr);
}

function computeMonthlyAverages(data: SCChartDataPoint[]): MonthlyAverages {
  const buckets: Record<number, number[]> = {};
  for (const d of data) {
    const m = parseInt(d.period.slice(5, 7), 10);
    if (!buckets[m]) buckets[m] = [];
    buckets[m].push(d.ratio);
  }
  const result: MonthlyAverages = {};
  for (let m = 1; m <= 12; m++) {
    const arr = buckets[m] ?? [];
    result[m] = arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
  }
  return result;
}

function findPeakMonth(monthly: MonthlyAverages): number {
  let best = 0;
  let bestVal = -1;
  for (let m = 1; m <= 12; m++) {
    const v = monthly[m] ?? 0;
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best;
}

/** 피크 6개월 전부터 가장 큰 비율 점프. 1.3배 미만이면 peak_month 자체 반환. */
function findRiseMonth(monthly: MonthlyAverages, peakMonth: number): number {
  const peakVal = monthly[peakMonth] ?? 0;
  if (peakVal <= 0) return peakMonth;

  let bestRatio = 0;
  let bestMonth = peakMonth;

  for (let offset = 1; offset <= 6; offset++) {
    const m = (((peakMonth - 1 - offset + 1) % 12) + 12) % 12 + 1; // 이번 달
    const prevM = (((m - 2) % 12) + 12) % 12 + 1; // 전 달
    const cur = monthly[m] ?? 0;
    const prev = monthly[prevM] ?? 0;
    if (prev > 0 && cur > prev) {
      const r = cur / prev;
      if (r > bestRatio) {
        bestRatio = r;
        bestMonth = m;
      }
    }
  }

  return bestRatio >= 1.3 ? bestMonth : peakMonth;
}

/** 피크 후 50% 이하 첫 도달 월. 없으면 0. */
function findDeclineMonth(monthly: MonthlyAverages, peakMonth: number): number {
  const peakVal = monthly[peakMonth] ?? 0;
  if (peakVal <= 0) return 0;
  const threshold = peakVal * 0.5;
  for (let offset = 1; offset < 12; offset++) {
    const m = ((peakMonth - 1 + offset) % 12) + 1;
    if ((monthly[m] ?? 0) <= threshold) return m;
  }
  return 0;
}

/** 피크 30%+ 유지 연속 구간 (예: '8월~10월'). */
function getDemandPeriod(monthly: MonthlyAverages, peakMonth: number): string {
  const peakVal = monthly[peakMonth] ?? 0;
  if (peakVal <= 0) return '-';
  const threshold = peakVal * 0.3;
  const high = new Set<number>();
  for (let m = 1; m <= 12; m++) {
    if ((monthly[m] ?? 0) >= threshold) high.add(m);
  }
  if (high.size === 0) return '-';

  let start = peakMonth;
  for (let offset = 1; offset < 12; offset++) {
    const m = (((peakMonth - 1 - offset) % 12) + 12) % 12 + 1;
    if (high.has(m)) start = m;
    else break;
  }
  let end = peakMonth;
  for (let offset = 1; offset < 12; offset++) {
    const m = ((peakMonth - 1 + offset) % 12) + 1;
    if (high.has(m)) end = m;
    else break;
  }

  if (start === end) return MONTH_NAMES[start] ?? `${start}월`;
  return `${MONTH_NAMES[start] ?? start}~${MONTH_NAMES[end] ?? end}`;
}

function monthInRange(target: number, start: number, end: number): boolean {
  if (start === 0 || end === 0) return false;
  if (start <= end) return target >= start && target <= end;
  return target >= start || target <= end;
}

function isDecliningAt(analysis: KeywordSeasonAnalysis, targetMonth: number): boolean {
  const cur = monthValue(analysis, targetMonth);
  const prevM = ((targetMonth - 2 + 12) % 12) + 1;
  const prev = monthValue(analysis, prevM);
  return prev > 0 && cur < prev * 0.9;
}

function monthValue(analysis: KeywordSeasonAnalysis, m: number): number {
  return analysis.monthlyAverages[m] ?? 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
