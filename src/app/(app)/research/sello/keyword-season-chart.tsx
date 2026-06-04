/**
 * 키워드 시즌 차트 컴포넌트
 *
 * sello-browser 행 클릭 시 그 아래로 펼쳐지는 expandable 콘텐츠.
 * /api/sellochomes/chart?keyword=... 호출해서 분석 결과 + 작년 12개월 차트 표시.
 *
 * SVG 막대그래프 (의존성 추가 없이 인라인 렌더).
 */
'use client';

import { useEffect, useState } from 'react';

import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

interface ChartPoint {
  month: number;
  label: string;
  ratio: number;
}

interface SeasonAnalysis {
  keyword: string;
  peak_month: number;
  rise_month: number;
  prep_month: number;
  decline_month: number;
  demand_period: string;
  seasonality_ratio: number;
  is_evergreen: boolean;
  data_quality: '부족' | '보통' | '충분';
  recent_30d_avg: number;
}

interface SuccessResponse {
  ok: true;
  keyword: string;
  fromCache: boolean;
  freshness: string;
  analysis: SeasonAnalysis | null;
  chart: ChartPoint[];
}

interface ErrorResponse {
  ok: false;
  error: string;
  code?: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

interface Props {
  keyword: string;
  /** 작년 1년 총 검색량 — 월별 절대 검색량 환산용 */
  yearTotalSearch?: number;
  /** 평균 월간 검색량 — yearTotalSearch 없을 때 fallback (× 12) */
  monthlyAvgSearch?: number;
}

export function KeywordSeasonChart({
  keyword,
  yearTotalSearch,
  monthlyAvgSearch,
}: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: SuccessResponse }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  const load = async (refresh = false) => {
    setState({ kind: 'loading' });
    try {
      const url = `/api/sellochomes/chart?keyword=${encodeURIComponent(keyword)}${
        refresh ? '&refresh=true' : ''
      }`;
      const res = await fetch(url);
      const body = (await res.json()) as ApiResponse;

      if (!body.ok) {
        setState({ kind: 'error', message: body.error });
        return;
      }
      setState({ kind: 'ready', data: body });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-base text-navy-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{keyword} 작년 검색 추이 가져오는 중…</span>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-base text-red-600">
        <AlertCircle className="h-5 w-5" />
        <span>차트 로드 실패: {state.message}</span>
        <button
          type="button"
          onClick={() => void load(true)}
          className="ml-auto rounded border border-red-300 px-3 py-1 text-sm hover:bg-red-50"
        >
          재시도
        </button>
      </div>
    );
  }

  const { data } = state;
  const { analysis, chart, fromCache, freshness } = data;

  if (chart.every((c) => c.ratio === 0)) {
    return (
      <div className="px-4 py-6 text-base text-navy-500">
        <div className="mb-2 font-semibold">📊 {keyword} — 작년 데이터 없음</div>
        <div className="text-sm text-navy-400">
          셀록홈즈에 이 키워드의 일별 차트 데이터가 없습니다.
        </div>
      </div>
    );
  }

  // ─── ratio → 절대 검색량 환산 ───
  // 작년 1년 ratio 합을 baseline 검색량으로 분배.
  // yearTotalSearch 가 있으면 그것을, 없으면 monthlyAvgSearch × 12 fallback.
  const totalRatio = chart.reduce((s, c) => s + c.ratio, 0);
  const baselineYear =
    yearTotalSearch && yearTotalSearch > 0
      ? yearTotalSearch
      : monthlyAvgSearch && monthlyAvgSearch > 0
        ? monthlyAvgSearch * 12
        : null;

  const chartWithVolume: Array<ChartPoint & { volume: number | null }> =
    baselineYear !== null && totalRatio > 0
      ? chart.map((c) => ({
          ...c,
          volume: Math.round((c.ratio / totalRatio) * baselineYear),
        }))
      : chart.map((c) => ({ ...c, volume: null }));

  const yearLabel = baselineYear ? `${baselineYear.toLocaleString('ko-KR')}회` : null;
  const volumeSource = yearTotalSearch && yearTotalSearch > 0 ? '작년 총 검색량' : '평균 월간 × 12';

  return (
    <div className="space-y-4 bg-violet-50/30 px-5 py-5">
      {/* 헤더 — 분석 요약 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
        <span className="text-lg font-bold text-navy-900">📊 {keyword}</span>
        <span className="text-sm text-navy-500">— 작년 12개월 검색량 분포</span>
        {analysis && (
          <>
            <Badge color="emerald">
              피크 <strong>{analysis.peak_month}월</strong>
            </Badge>
            <Badge color="amber">
              준비 <strong>{analysis.prep_month}월</strong>
            </Badge>
            <Badge color="violet">{analysis.demand_period}</Badge>
            <Badge color={analysis.is_evergreen ? 'navy' : 'rose'}>
              {analysis.is_evergreen ? '상시' : '시즌'}{' '}
              <strong>{analysis.seasonality_ratio.toFixed(1)}x</strong>
            </Badge>
            <Badge color="navy" muted>
              데이터 {analysis.data_quality}
            </Badge>
          </>
        )}
        <span className="ml-auto text-xs text-navy-400">
          {fromCache ? '⚡ 캐시' : '🌐 새로'} · {freshness}
          <button
            type="button"
            onClick={() => void load(true)}
            className="ml-2 inline-flex items-center gap-0.5 rounded border border-navy-200 px-2 py-1 text-xs hover:bg-white"
            title="캐시 무시하고 다시 받기"
          >
            <RefreshCw className="h-3 w-3" /> 새로
          </button>
        </span>
      </div>

      {yearLabel && (
        <div className="text-sm text-navy-500">
          기준: <strong className="text-navy-700">{yearLabel}</strong>{' '}
          ({volumeSource}) — 일별 ratio 비율로 월별 검색량 환산
        </div>
      )}

      {/* SVG 막대그래프 */}
      <BarChart
        chart={chartWithVolume}
        peakMonth={analysis?.peak_month}
        prepMonth={analysis?.prep_month}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SVG 막대그래프
// ─────────────────────────────────────────────────────────

interface BarChartProps {
  chart: Array<ChartPoint & { volume: number | null }>;
  peakMonth?: number | undefined;
  prepMonth?: number | undefined;
}

function BarChart({ chart, peakMonth, prepMonth }: BarChartProps) {
  const W = 900;
  const H = 260;
  const PAD_TOP = 28;
  const PAD_BOTTOM = 40;
  const PAD_LEFT = 76;
  const PAD_RIGHT = 12;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const barGap = 6;
  const barW = (innerW - barGap * 11) / 12;

  // 환산된 검색량이 있으면 그걸 쓰고, 없으면 ratio 폴백
  const hasVolume = chart.some((c) => c.volume !== null && c.volume > 0);
  const values = chart.map((c) => (hasVolume ? (c.volume ?? 0) : c.ratio));
  const maxValue = Math.max(...values, 1);

  // y축 눈금 — 0, 50%, 100%
  const yTicks = [0, maxValue / 2, maxValue];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full max-w-3xl"
        role="img"
        aria-label="작년 12개월 검색량 분포"
      >
        {/* y축 눈금선 */}
        {yTicks.map((t, i) => {
          const y = PAD_TOP + innerH - (t / maxValue) * innerH;
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                x2={W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="2 3"
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#94a3b8"
              >
                {hasVolume ? formatVolumeShort(t) : t.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* 막대 + 월 라벨 */}
        {chart.map((c, i) => {
          const x = PAD_LEFT + i * (barW + barGap);
          const value = hasVolume ? (c.volume ?? 0) : c.ratio;
          const h = (value / maxValue) * innerH;
          const y = PAD_TOP + innerH - h;

          const isPeak = peakMonth === c.month;
          const isPrep = prepMonth === c.month;
          const fill = isPeak
            ? '#10b981'
            : isPrep
              ? '#f59e0b'
              : '#a78bfa';

          return (
            <g key={c.month}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                rx={2}
                fill={fill}
                opacity={value > 0 ? 1 : 0.3}
              >
                <title>
                  {c.label}
                  {hasVolume && c.volume !== null
                    ? `: ${c.volume.toLocaleString('ko-KR')}회`
                    : `: ratio ${c.ratio.toFixed(1)}`}
                </title>
              </rect>
              {/* 값 라벨 (피크/준비만 강조) */}
              {(isPeak || isPrep) && value > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="bold"
                  fill={fill}
                >
                  {hasVolume && c.volume !== null
                    ? formatVolumeShort(c.volume)
                    : c.ratio.toFixed(0)}
                </text>
              )}
              {/* 월 라벨 */}
              <text
                x={x + barW / 2}
                y={H - 18}
                textAnchor="middle"
                fontSize="13"
                fill={isPeak || isPrep ? fill : '#64748b'}
                fontWeight={isPeak || isPrep ? 'bold' : 'normal'}
              >
                {c.label}
              </text>
              {/* 마커 — 피크 ⭐ / 준비 🔥 */}
              {isPeak && (
                <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize="12" fill={fill}>
                  ⭐
                </text>
              )}
              {isPrep && !isPeak && (
                <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize="12" fill={fill}>
                  🔥
                </text>
              )}
            </g>
          );
        })}

        {/* y축 라벨 */}
        <text
          x={10}
          y={PAD_TOP + innerH / 2}
          textAnchor="start"
          fontSize="12"
          fill="#94a3b8"
          transform={`rotate(-90 10 ${PAD_TOP + innerH / 2})`}
        >
          {hasVolume ? '검색량(회)' : 'ratio'}
        </text>
      </svg>
      <div className="mt-3 flex items-center gap-4 text-sm text-navy-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" /> ⭐ 피크월
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" /> 🔥 준비월 (지금
          소싱 시작!)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-violet-400" /> 일반
        </span>
      </div>
    </div>
  );
}

/** 큰 숫자를 짧게 (예: 12345 → "12.3K", 1234567 → "1.2M") */
function formatVolumeShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

// ─────────────────────────────────────────────────────────
// 작은 뱃지
// ─────────────────────────────────────────────────────────

interface BadgeProps {
  children: React.ReactNode;
  color: 'emerald' | 'amber' | 'violet' | 'navy' | 'rose';
  muted?: boolean;
}

function Badge({ children, color, muted }: BadgeProps) {
  const baseMap: Record<BadgeProps['color'], string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
    navy: 'bg-navy-50 text-navy-700',
    rose: 'bg-rose-50 text-rose-700',
  };
  const cls = muted ? 'bg-slate-50 text-slate-600' : baseMap[color];
  return (
    <span className={`rounded px-2.5 py-1 text-sm ${cls}`}>{children}</span>
  );
}
