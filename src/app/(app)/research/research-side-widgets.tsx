/**
 * 우측 사이드 위젯 — /research 페이지 보조 콘텐츠
 *
 * 구성:
 * 1. 시즌 펄스 Top 3 (실시간 추천 미리보기)
 * 2. 빠른 작업 링크 (시즌 펄스 / 1688 검색 등)
 * 3. 형 운영 팁
 *
 * 데이터: /api/season-recommendations (시즌 펄스 API 재사용)
 * 자동 새로고침: 페이지 마운트 시 1회 (가벼움)
 */
'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { BarChart3, Sparkles, TrendingUp, Zap } from 'lucide-react';

interface ChartPoint {
  month: number;
  label: string;
  ratio: number;
}

interface Analysis {
  keyword: string;
  peak_month: number;
  prep_month: number;
  seasonality_ratio: number;
}

interface RecommendationItem {
  keyword: string;
  score: number;
  reason: string;
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
}

interface ApiError {
  ok: false;
  error: string;
}

export function ResearchSideWidgets() {
  return (
    <div className="space-y-4">
      <SeasonPulseTop3 />
      <QuickActions />
      <TipsCard />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 시즌 펄스 Top 3
// ─────────────────────────────────────────────────────────

function SeasonPulseTop3() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: ApiSuccess }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    const now = new Date();
    const nextMonth = (now.getMonth() + 1) % 12 + 1;
    fetch(`/api/season-recommendations?month=${nextMonth}`)
      .then((r) => r.json() as Promise<ApiSuccess | ApiError>)
      .then((body) => {
        if (body.ok) setState({ kind: 'ready', data: body });
        else setState({ kind: 'error', message: body.error });
      })
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'unknown',
        }),
      );
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-violet-700">
          <TrendingUp className="h-4 w-4" />
          시즌 펄스 Top 3
        </div>
        <div className="text-xs text-navy-400">분석 중…</div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
        <div className="mb-1 text-sm font-bold text-amber-700">
          ⚠ 시즌 펄스 로드 실패
        </div>
        <div className="text-xs text-navy-500">{state.message}</div>
      </div>
    );
  }

  const { data } = state;
  // 5점 그룹 우선, 부족하면 4점에서 보충
  const top3 = [
    ...data.groups.now_prep,
    ...data.groups.rising,
    ...data.groups.peak_soon,
  ].slice(0, 3);

  return (
    <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-amber-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-violet-700">
          <TrendingUp className="h-4 w-4" />
          🌊 시즌 펄스 Top 3
        </div>
        <span className="text-[10px] text-violet-600">{data.month}월 기준</span>
      </div>

      {top3.length === 0 ? (
        <div className="text-xs text-navy-500">이번 달 추천 키워드 없음</div>
      ) : (
        <div className="space-y-2">
          {top3.map((it, idx) => (
            <MiniCard key={it.keyword} item={it} rank={idx + 1} />
          ))}
        </div>
      )}

      <Link
        href="/research/season-pulse"
        className="mt-3 block rounded border border-violet-300 bg-white px-3 py-2 text-center text-xs font-semibold text-violet-700 hover:bg-violet-100"
      >
        전체 추천 보기 →
      </Link>
    </div>
  );
}

function MiniCard({ item, rank }: { item: RecommendationItem; rank: number }) {
  const max = Math.max(...item.chart.map((c) => c.ratio), 1);
  return (
    <div className="rounded-md border border-violet-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold text-violet-500">#{rank}</span>
          <span className="truncate text-sm font-semibold text-navy-900">
            {item.keyword}
          </span>
        </div>
        <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
          {'★'.repeat(item.score)}
        </span>
      </div>
      <div className="mt-1.5 flex items-end gap-px h-6">
        {item.chart.map((c) => {
          const h = (c.ratio / max) * 100;
          const isPeak = c.month === item.analysis.peak_month;
          const isPrep = c.month === item.analysis.prep_month;
          const color = isPeak
            ? 'bg-emerald-500'
            : isPrep
              ? 'bg-amber-500'
              : 'bg-violet-300';
          return (
            <div
              key={c.month}
              className={`flex-1 ${color}`}
              style={{ height: `${Math.max(4, h)}%` }}
              title={`${c.label}: ${c.ratio.toFixed(1)}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-navy-500">
        <span>피크 {item.analysis.peak_month}월</span>
        <span>·</span>
        <span>준비 {item.analysis.prep_month}월</span>
        <span>·</span>
        <span className="font-semibold text-violet-700">
          {item.analysis.seasonality_ratio.toFixed(1)}x
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 빠른 작업
// ─────────────────────────────────────────────────────────

function QuickActions() {
  const links = [
    {
      href: '/research/season-pulse',
      icon: Sparkles,
      label: '시즌 펄스 전체',
      desc: '549개 키워드 자동 분석',
      color: 'violet',
    },
    {
      href: '/research/coupang-first-page',
      icon: BarChart3,
      label: '1페이지 메트릭',
      desc: '쿠팡 상위 20개 분석',
      color: 'blue',
    },
    {
      href: '/products?stage=research',
      icon: Zap,
      label: '장바구니 전체',
      desc: '담아둔 상품 보기',
      color: 'teal',
    },
  ] as const;

  const colorMap: Record<string, string> = {
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    teal: 'border-teal-200 bg-teal-50 text-teal-700',
  };

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <div className="mb-3 text-sm font-bold text-navy-700">⚡ 빠른 작업</div>
      <div className="space-y-1.5">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-2.5 rounded-md border border-navy-100 px-2.5 py-2 transition hover:border-navy-300 hover:bg-navy-50"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${colorMap[link.color]}`}
            >
              <link.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-navy-800">
                {link.label}
              </div>
              <div className="truncate text-[10px] text-navy-500">
                {link.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 운영 팁
// ─────────────────────────────────────────────────────────

function TipsCard() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="mb-2 text-sm font-bold text-emerald-800">💡 시즌 팁</div>
      <ul className="space-y-1.5 text-xs leading-relaxed text-navy-700">
        <li>
          <strong className="text-emerald-700">중국 소싱</strong> = 피크 2~3개월 전 시작
        </li>
        <li>
          <strong className="text-emerald-700">국내 위탁</strong> = 피크 2~4주 전 시작
        </li>
        <li>
          마진 <strong className="text-emerald-700">30%+</strong> 안 되면 PASS
        </li>
        <li>
          쿠팡 리뷰 작업 + 상단 노출 무기 활용
        </li>
      </ul>
    </div>
  );
}
