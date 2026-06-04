/**
 * 시즌 펄스 — 클라이언트 컴포넌트.
 *
 * 데이터 흐름:
 * 1. 페이지 마운트 시 /api/season-recommendations?month=다음달 호출
 * 2. 4개 그룹별로 카드 렌더링
 * 3. 카드: 키워드 / 미니 스파크라인 / 시즌성 / 액션 버튼
 *
 * 액션:
 * - "📊 자세히" → 새 탭에서 셀록홈즈 분석 페이지
 * - "🔍 1688" → 1688.com 새 탭 검색
 * - "🛒 담기" → BUYWISE 1단계 장바구니에 추가 (서버 액션)
 */
'use client';

import { useEffect, useState } from 'react';

import { AlertCircle, Loader2, RefreshCw, ShoppingCart, Search, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

import { quickAddToBasketAction } from '@/lib/products/actions';

interface ChartPoint {
  month: number;
  label: string;
  ratio: number;
}

interface Analysis {
  keyword: string;
  peak_month: number;
  rise_month: number;
  prep_month: number;
  decline_month: number;
  demand_period: string;
  seasonality_ratio: number;
  is_evergreen: boolean;
  data_quality: '부족' | '보통' | '충분';
  peak_ratio: number;
  recent_30d_avg: number;
}

interface RecommendationItem {
  keyword: string;
  score: number;
  reason: string;
  caution: string;
  analysis: Analysis;
  chart: ChartPoint[];
}

interface ApiSuccess {
  ok: true;
  month: number;
  totalAnalyzed: number;
  totalRecommended: number;
  groups: {
    now_prep: RecommendationItem[];
    rising: RecommendationItem[];
    peak_soon: RecommendationItem[];
    in_demand: RecommendationItem[];
  };
  generatedAt: string;
  computeMs: number;
}

interface ApiError {
  ok: false;
  error: string;
}

type ApiResponse = ApiSuccess | ApiError;

type GroupKey = keyof ApiSuccess['groups'];

const GROUP_META: Record<
  GroupKey,
  { emoji: string; title: string; subtitle: string; color: string }
> = {
  now_prep: {
    emoji: '🚨',
    title: '지금 소싱 시작',
    subtitle: '다음 달부터 검색량 급상승. 리드타임 고려해 지금 1688/타오바오 검색!',
    color: 'border-amber-300 bg-amber-50/50',
  },
  rising: {
    emoji: '📅',
    title: '이번 달 급상승',
    subtitle: '이번 달부터 검색량 급증. 재고 확보 + 등록 마무리 시점.',
    color: 'border-emerald-300 bg-emerald-50/50',
  },
  peak_soon: {
    emoji: '⏳',
    title: '다음 달 피크',
    subtitle: '다음 달이 검색량 최고점. 바로 판매 가능한 재고는 즉시 노출.',
    color: 'border-rose-300 bg-rose-50/50',
  },
  in_demand: {
    emoji: '📈',
    title: '진행 중',
    subtitle: '아직 상승 구간. 확정된 후보 보강용.',
    color: 'border-violet-300 bg-violet-50/50',
  },
};

export function SeasonPulseClient() {
  const now = new Date();
  const defaultMonth = (now.getMonth() + 1) % 12 + 1; // 다음 달

  const [month, setMonth] = useState(defaultMonth);
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; data: ApiSuccess }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const load = async (m: number) => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/season-recommendations?month=${m}`);
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
    void load(month);
     
  }, [month]);

  return (
    <div className="space-y-6">
      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-navy-200 bg-white px-5 py-4">
        <label className="text-base font-medium text-navy-700">타겟월</label>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value, 10))}
          className="rounded border border-navy-200 px-3 py-1.5 text-base"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
        <span className="text-sm text-navy-500">
          기본: 다음 달 ({defaultMonth}월) — 시즌상품은 미리 준비!
        </span>
        <button
          type="button"
          onClick={() => void load(month)}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-navy-200 px-3 py-1.5 text-sm hover:bg-navy-50"
        >
          <RefreshCw className="h-4 w-4" />
          재계산
        </button>
      </div>

      {/* 상태별 렌더 */}
      {state.kind === 'loading' && (
        <div className="flex items-center gap-2 px-4 py-12 text-base text-navy-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>키워드 풀 분석 중… (~3초)</span>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
          <AlertCircle className="h-5 w-5" />
          <span>분석 실패: {state.message}</span>
        </div>
      )}

      {state.kind === 'ready' && <Results data={state.data} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 — 4그룹
// ─────────────────────────────────────────────────────────

function Results({ data }: { data: ApiSuccess }) {
  const { groups, totalAnalyzed, totalRecommended, computeMs } = data;

  // 4그룹 통계
  const counts = {
    now_prep: groups.now_prep.length,
    rising: groups.rising.length,
    peak_soon: groups.peak_soon.length,
    in_demand: groups.in_demand.length,
  };

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-navy-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 className="text-2xl font-bold text-navy-900">
            🗓️ {data.month}월 시즌 후보
          </h2>
          <span className="text-base text-navy-500">
            전체 분석 <strong className="text-navy-700">{totalAnalyzed}</strong>개 → 추천{' '}
            <strong className="text-emerald-700">{totalRecommended}</strong>개
          </span>
          <span className="text-sm text-navy-400">
            · {(computeMs / 1000).toFixed(1)}초 ·{' '}
            {new Date(data.generatedAt).toLocaleString('ko-KR')}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <CountChip emoji="🚨" label="지금 소싱" count={counts.now_prep} color="amber" />
          <CountChip emoji="📅" label="이번달 급상승" count={counts.rising} color="emerald" />
          <CountChip emoji="⏳" label="다음달 피크" count={counts.peak_soon} color="rose" />
          <CountChip emoji="📈" label="진행 중" count={counts.in_demand} color="violet" />
        </div>
      </div>

      {(['now_prep', 'rising', 'peak_soon', 'in_demand'] as const).map((key) => (
        <Group key={key} groupKey={key} items={groups[key]} />
      ))}
    </div>
  );
}

function CountChip({
  emoji,
  label,
  count,
  color,
}: {
  emoji: string;
  label: string;
  count: number;
  color: 'amber' | 'emerald' | 'rose' | 'violet';
}) {
  const colors: Record<typeof color, string> = {
    amber: 'bg-amber-100 text-amber-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    rose: 'bg-rose-100 text-rose-800',
    violet: 'bg-violet-100 text-violet-800',
  };
  return (
    <span className={`rounded px-2.5 py-1.5 text-sm ${colors[color]}`}>
      {emoji} {label} <strong>{count}</strong>
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// 그룹 (카드 그리드)
// ─────────────────────────────────────────────────────────

function Group({
  groupKey,
  items,
}: {
  groupKey: GroupKey;
  items: RecommendationItem[];
}) {
  const meta = GROUP_META[groupKey];

  if (items.length === 0) {
    return (
      <section>
        <header className="mb-4 flex items-center gap-2">
          <h3 className="text-xl font-bold text-navy-900">
            {meta.emoji} {meta.title}
          </h3>
          <span className="text-sm text-navy-400">— 0개</span>
        </header>
        <div className={`rounded-lg border-2 border-dashed ${meta.color} px-4 py-6 text-center text-base text-navy-400`}>
          이 그룹에 해당하는 키워드 없음
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="mb-4">
        <h3 className="flex items-center gap-2 text-xl font-bold text-navy-900">
          {meta.emoji} {meta.title}
          <span className="rounded bg-navy-100 px-2.5 py-1 text-sm text-navy-700">
            {items.length}개
          </span>
        </h3>
        <p className="mt-1 text-sm text-navy-500">{meta.subtitle}</p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Card key={it.keyword} item={it} groupKey={groupKey} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────

function Card({ item, groupKey }: { item: RecommendationItem; groupKey: GroupKey }) {
  const meta = GROUP_META[groupKey];
  const [adding, setAdding] = useState(false);

  const handleAddToBasket = async () => {
    setAdding(true);
    try {
      const formData = new FormData();
      formData.set('name', item.keyword);
      formData.set(
        'memo',
        `시즌 펄스 ${item.score}점 · 피크 ${item.analysis.peak_month}월 · 시즌성 ${item.analysis.seasonality_ratio.toFixed(1)}x`,
      );
      // quickAddToBasketAction 은 성공 시 Promise<void>, 실패 시 throw
      await quickAddToBasketAction(formData);
      toast.success(`'${item.keyword}' 장바구니 담음 ✓`);
    } catch (err) {
      toast.error(
        `담기 실패: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`rounded-lg border ${meta.color} p-4 transition hover:shadow-md`}>
      {/* 헤더 — 키워드 + 점수 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-navy-900">{item.keyword}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-navy-500">
            <span>피크 {item.analysis.peak_month}월</span>
            <span>·</span>
            <span>준비 {item.analysis.prep_month}월</span>
            <span>·</span>
            <span className="font-semibold text-navy-700">
              {item.analysis.seasonality_ratio.toFixed(1)}x
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="rounded bg-white px-2 py-0.5 text-xs font-bold text-navy-700">
            {'★'.repeat(item.score)}
          </span>
          <span className="text-[10px] text-navy-400">
            {item.analysis.demand_period}
          </span>
        </div>
      </div>

      {/* 미니 스파크라인 */}
      <div className="mt-3">
        <Sparkline
          chart={item.chart}
          peakMonth={item.analysis.peak_month}
          prepMonth={item.analysis.prep_month}
        />
      </div>

      {/* 이유 */}
      <p className="mt-3 line-clamp-2 text-sm text-navy-600">{item.reason}</p>
      {item.caution !== '-' && (
        <p className="mt-1 line-clamp-1 text-xs text-amber-700">⚠ {item.caution}</p>
      )}

      {/* 액션 버튼 */}
      <div className="mt-4 flex gap-2">
        <a
          href={`/research/sello?keyword=${encodeURIComponent(item.keyword)}`}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-700 hover:border-violet-300 hover:bg-violet-50"
        >
          <BarChart3 className="h-4 w-4" /> 자세히
        </a>
        <a
          href={`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(item.keyword)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-700 hover:border-orange-300 hover:bg-orange-50"
        >
          <Search className="h-4 w-4" /> 1688
        </a>
        <button
          type="button"
          onClick={() => void handleAddToBasket()}
          disabled={adding}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-violet-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <ShoppingCart className="h-4 w-4" />
          {adding ? '담는 중' : '담기'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 미니 스파크라인 (12개월)
// ─────────────────────────────────────────────────────────

function Sparkline({
  chart,
  peakMonth,
  prepMonth,
}: {
  chart: ChartPoint[];
  peakMonth: number;
  prepMonth: number;
}) {
  const W = 240;
  const H = 36;
  const PAD_Y = 2;
  const innerH = H - PAD_Y * 2;
  const barW = W / 12 - 1;

  const max = Math.max(...chart.map((c) => c.ratio), 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label="작년 12개월 추이"
    >
      {chart.map((c, i) => {
        const x = i * (W / 12);
        const h = (c.ratio / max) * innerH;
        const y = PAD_Y + innerH - h;
        const isPeak = c.month === peakMonth;
        const isPrep = c.month === prepMonth;
        const fill = isPeak ? '#10b981' : isPrep ? '#f59e0b' : '#a78bfa';
        return (
          <rect
            key={c.month}
            x={x}
            y={y}
            width={barW}
            height={Math.max(1, h)}
            rx={1}
            fill={fill}
            opacity={c.ratio > 0 ? 0.9 : 0.3}
          >
            <title>
              {c.label}: ratio {c.ratio.toFixed(1)}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
