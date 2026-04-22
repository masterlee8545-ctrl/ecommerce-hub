/**
 * /research/coupang-first-page — 키워드 입력 + 1페이지 메트릭 표 (클라이언트)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-2 (실패 시 명시 에러),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 키워드 입력 → GET /api/research/coupang-first-page?keyword=&lt;검색어&gt; 호출
 * - 응답 메트릭을 표로 렌더 (랭킹 / 로켓 / 리뷰수 / 상품명)
 * - 404 (캐시 미스) 시 CLI 스크래핑 명령 안내
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useSearchParams } from 'next/navigation';

import { ExternalLink, Loader2, Rocket, Search, Terminal, Zap } from 'lucide-react';

// ─────────────────────────────────────────────────────────
// 타입 — API 응답 구조
// ─────────────────────────────────────────────────────────

interface FirstPageReviewRow {
  rank: number;
  name: string;
  reviewCount: number;
  isRocket: boolean;
  price: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  monthlySales: number | null;
}

interface FirstPagePriceStats {
  min: number | null;
  median: number | null;
  max: number | null;
  avg: number | null;
  sampleSize: number;
}

interface FirstPageMetrics {
  keyword: string;
  rowCount: number;
  rocketRatio: number;
  reviews: FirstPageReviewRow[];
  priceStats: FirstPagePriceStats;
  source: 'hub' | 'buywise';
}

interface ApiOk {
  ok: true;
  metrics: FirstPageMetrics;
}

interface ApiError {
  ok: false;
  error: string;
  cacheMiss?: boolean;
}

type ApiResponse = ApiOk | ApiError;

// ─────────────────────────────────────────────────────────
// 상수 — 로켓 비율 구간 (토큰 색상 결정)
// ─────────────────────────────────────────────────────────

/** 로켓 비율이 이 값 이상이면 🔴 red — 과포화 시장 */
const ROCKET_RATIO_HIGH = 0.5;
/** 로켓 비율이 이 값 이상이면 🟠 amber — 경쟁 주의 */
const ROCKET_RATIO_MEDIUM = 0.3;

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

/** 상태 머신: 유휴 → 캐시조회 → (미스면) 스크래핑 중 → 완료 */
type FormState =
  | { phase: 'idle' }
  | { phase: 'fetching-cache' }
  | { phase: 'scraping'; keyword: string; startedAt: number }
  | { phase: 'done'; metrics: FirstPageMetrics }
  | { phase: 'error'; message: string }
  | { phase: 'login-required'; keyword: string };

/** 스크래핑 세로 진행바 — 예상 60초 기준 표시 */
const EXPECTED_SCRAPE_MS = 60_000;
/** 경과시간 폴링 주기 */
const TICK_INTERVAL_MS = 500;

export function FirstPageForm() {
  // URL ?keyword=X 가 있으면 자동 제출 (ItemScoutBrowser 에서 담기 → 여기로 redirect)
  const searchParams = useSearchParams();
  const urlKeyword = searchParams.get('keyword') ?? '';

  const [keyword, setKeyword] = useState(urlKeyword);
  const [state, setState] = useState<FormState>({ phase: 'idle' });
  const [elapsed, setElapsed] = useState(0);

  // 스크래핑 중 경과시간 업데이트
  useEffect(() => {
    if (state.phase !== 'scraping') return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - state.startedAt);
    }, TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state]);

  /**
   * 캐시 조회 → 미스면 스크래핑 → 다시 조회 → 결과 표시.
   */
  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keyword.trim();
    if (!trimmed) return;

    setState({ phase: 'fetching-cache' });
    setElapsed(0);

    // 1. 캐시 조회
    try {
      const res = await fetch(
        `/api/research/coupang-first-page?keyword=${encodeURIComponent(trimmed)}`,
      );
      const body = (await res.json()) as ApiResponse;
      if (body.ok) {
        setState({ phase: 'done', metrics: body.metrics });
        return;
      }
      if (body.cacheMiss !== true) {
        setState({ phase: 'error', message: body.error });
        return;
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : '네트워크 오류',
      });
      return;
    }

    // 2. 캐시 미스 → 실시간 스크래핑 시작
    setState({ phase: 'scraping', keyword: trimmed, startedAt: Date.now() });

    try {
      const scrapeRes = await fetch('/api/research/coupang-first-page/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: trimmed }),
      });
      const scrapeBody = (await scrapeRes.json()) as {
        ok: boolean;
        reason?: 'login-required' | 'locked' | 'launch-failed' | 'timeout' | 'other';
        error?: string;
      };

      if (!scrapeBody.ok) {
        if (scrapeBody.reason === 'login-required') {
          setState({ phase: 'login-required', keyword: trimmed });
        } else {
          setState({
            phase: 'error',
            message: scrapeBody.error ?? '스크래핑 실패',
          });
        }
        return;
      }

      // 3. 스크래핑 완료 → 캐시에서 다시 조회
      const finalRes = await fetch(
        `/api/research/coupang-first-page?keyword=${encodeURIComponent(trimmed)}`,
      );
      const finalBody = (await finalRes.json()) as ApiResponse;
      if (finalBody.ok) {
        setState({ phase: 'done', metrics: finalBody.metrics });
      } else {
        setState({
          phase: 'error',
          message: finalBody.error,
        });
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : '스크래핑 중 네트워크 오류',
      });
    }
  }, [keyword]);

  // URL 에 ?keyword=X 가 있으면 자동 실행 (mount 시 1회)
  const autoSubmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlKeyword) return;
    if (autoSubmittedRef.current === urlKeyword) return;
    if (state.phase !== 'idle') return;
    autoSubmittedRef.current = urlKeyword;
    // 폼의 submit 과 동일 로직 — preventDefault 는 no-op
    void submit({ preventDefault: () => undefined } as React.FormEvent);
  }, [urlKeyword, submit, state.phase]);

  const isWorking = state.phase === 'fetching-cache' || state.phase === 'scraping';

  const progressPct = Math.min(100, Math.round((elapsed / EXPECTED_SCRAPE_MS) * 100));

  return (
    <div className="space-y-4">
      {/* 입력 폼 */}
      <form onSubmit={submit} className="flex items-stretch gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="예: 러닝벨트, 사과, 실리콘 마늘다지기"
          className="flex-1 rounded-lg border border-navy-200 bg-white px-4 py-3 text-base text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          disabled={isWorking}
        />
        <button
          type="submit"
          disabled={isWorking || !keyword.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.phase === 'fetching-cache' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              캐시 조회 중...
            </>
          ) : state.phase === 'scraping' ? (
            <>
              <Zap className="h-5 w-5 animate-pulse" />
              실시간 스크래핑 중...
            </>
          ) : (
            <>
              <Search className="h-5 w-5" />
              조회
            </>
          )}
        </button>
      </form>

      {/* 스크래핑 진행 — 경과 시간 + 진행바 */}
      {state.phase === 'scraping' && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-bold text-navy-900">
              <Zap className="h-5 w-5 animate-pulse text-blue-700" />
              &quot;{state.keyword}&quot; 실시간 스크래핑 중
            </div>
            <span className="font-mono text-sm font-semibold text-navy-600">
              {Math.round(elapsed / 1000)}s
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-navy-100">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-sm text-navy-700">
            💡 Chrome 이 화면 밖에서 조용히 돌아갑니다. 30~90초 소요.
          </p>
        </div>
      )}

      {/* 로그인 필요 */}
      {state.phase === 'login-required' && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <div className="flex items-center gap-2 text-base font-bold">
            <Terminal className="h-5 w-5" />
            셀록홈즈 로그인이 필요합니다
          </div>
          <p className="text-sm leading-relaxed">
            최초 1회만 터미널에서 아래 명령 실행 → Chrome 에서 로그인 완료 후 다시 조회하세요.
            (쿠팡 윙 로그인은 필요 없습니다 — 스크래핑 대상은 sellochomes.co.kr)
          </p>
          <pre className="rounded-md bg-navy-900 p-3 text-sm text-teal-200">
            <code>npm run sello:scrape -- {state.keyword}</code>
          </pre>
        </div>
      )}

      {/* 일반 에러 */}
      {state.phase === 'error' && (
        <div className="space-y-1 rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
          <div className="text-base font-bold">조회 실패</div>
          <p className="whitespace-pre-wrap text-sm">{state.message}</p>
        </div>
      )}

      {/* 결과 표 */}
      {state.phase === 'done' && <MetricsTable metrics={state.metrics} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 테이블
// ─────────────────────────────────────────────────────────

function MetricsTable({ metrics }: { metrics: FirstPageMetrics }) {
  const rocketCount = metrics.reviews.filter((r) => r.isRocket).length;
  const totalReviews = metrics.reviews.reduce((s, r) => s + r.reviewCount, 0);
  const rocketReviews = metrics.reviews
    .filter((r) => r.isRocket)
    .reduce((s, r) => s + r.reviewCount, 0);
  const avgReviews = metrics.rowCount > 0 ? Math.round(totalReviews / metrics.rowCount) : 0;
  const medianReviews = median(metrics.reviews.map((r) => r.reviewCount));

  return (
    <section className="space-y-4 rounded-lg border border-navy-200 bg-white p-5">
      {/* 요약 통계 */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-navy-900">{metrics.keyword}</h2>
          <span
            className={
              metrics.source === 'hub'
                ? 'rounded bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800'
                : 'rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800'
            }
          >
            {metrics.source === 'hub' ? 'HUB 캐시' : 'BUYWISE 캐시'}
          </span>
        </div>
        <p className="mt-1 text-xs text-navy-500">
          쿠팡 1페이지 상위 {metrics.rowCount}개 상품 — 진입 난이도 지표
        </p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiCard
          label="로켓 비율"
          value={`${(metrics.rocketRatio * 100).toFixed(0)}%`}
          sub={`${rocketCount}/${metrics.rowCount}개`}
          tone={
            metrics.rocketRatio >= ROCKET_RATIO_HIGH
              ? 'red'
              : metrics.rocketRatio >= ROCKET_RATIO_MEDIUM
                ? 'amber'
                : 'emerald'
          }
        />
        <KpiCard
          label="총 리뷰"
          value={totalReviews.toLocaleString('ko-KR')}
          sub="20개 합계"
          tone="navy"
        />
        <KpiCard
          label="평균 리뷰"
          value={avgReviews.toLocaleString('ko-KR')}
          sub="상품당"
          tone="navy"
        />
        <KpiCard
          label="중앙값"
          value={medianReviews.toLocaleString('ko-KR')}
          sub="리뷰 중앙값"
          tone="navy"
        />
      </div>

      {/* 로켓 vs 일반 리뷰 합계 */}
      <div className="rounded-md border border-navy-100 bg-navy-50/30 p-3 text-xs text-navy-600">
        <span className="font-semibold text-navy-800">리뷰 분포:</span>
        {' '}
        로켓 {rocketReviews.toLocaleString('ko-KR')}리뷰
        {' / '}
        일반 {(totalReviews - rocketReviews).toLocaleString('ko-KR')}리뷰
      </div>

      {/* 가격 통계 KPI (가격 수집된 상품이 있을 때만) */}
      {metrics.priceStats.sampleSize > 0 && (
        <div className="rounded-md border border-navy-100 bg-white p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-navy-500">
            💰 가격 분포 ({metrics.priceStats.sampleSize}/{metrics.rowCount}개 집계)
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <PriceStat label="최저" value={metrics.priceStats.min} tone="emerald" />
            <PriceStat label="중앙" value={metrics.priceStats.median} tone="navy" />
            <PriceStat label="평균" value={metrics.priceStats.avg} tone="navy" />
            <PriceStat label="최고" value={metrics.priceStats.max} tone="red" />
          </div>
        </div>
      )}

      {/* 상품 리스트 표 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-200 text-left text-xs text-navy-500">
              <th className="w-10 py-2">순위</th>
              <th className="w-14 py-2">썸네일</th>
              <th className="w-14 py-2">배송</th>
              <th className="w-24 py-2 text-right">가격</th>
              <th className="w-20 py-2 text-right">리뷰</th>
              <th className="w-16 py-2 text-right">월 판매</th>
              <th className="py-2">상품명</th>
            </tr>
          </thead>
          <tbody>
            {metrics.reviews.map((r) => (
              <tr key={r.rank} className="border-b border-navy-50 text-navy-800">
                <td className="py-2 font-mono text-xs">#{r.rank}</td>
                <td className="py-2">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.imageUrl}
                      alt=""
                      className="h-10 w-10 rounded border border-navy-100 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded border border-dashed border-navy-200 bg-navy-50/50" />
                  )}
                </td>
                <td className="py-2">
                  {r.isRocket ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                      <Rocket className="h-2.5 w-2.5" />
                      로켓
                    </span>
                  ) : (
                    <span className="text-[10px] text-navy-400">일반</span>
                  )}
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  {r.price != null ? `₩${r.price.toLocaleString('ko-KR')}` : '—'}
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  {r.reviewCount.toLocaleString('ko-KR')}
                </td>
                <td className="py-2 text-right font-mono text-[11px] text-navy-500">
                  {r.monthlySales != null ? r.monthlySales.toLocaleString('ko-KR') : '—'}
                </td>
                <td className="py-2 text-xs">
                  {r.productUrl ? (
                    <a
                      href={r.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-teal-700"
                      title={r.name}
                    >
                      <span className="line-clamp-2">{r.name || '—'}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-navy-400" />
                    </a>
                  ) : (
                    <span className="line-clamp-2" title={r.name}>{r.name || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 가격 통계 타일 하나 */
function PriceStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: 'emerald' | 'navy' | 'red';
}) {
  const toneClass = {
    emerald: 'text-emerald-700',
    navy: 'text-navy-800',
    red: 'text-red-700',
  }[tone];
  return (
    <div>
      <div className="text-[10px] text-navy-500">{label}</div>
      <div className={`text-sm font-bold ${toneClass}`}>
        {value != null ? `₩${value.toLocaleString('ko-KR')}` : '—'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'emerald' | 'amber' | 'red' | 'navy';
}) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50/50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50/50 text-amber-900',
    red: 'border-red-200 bg-red-50/50 text-red-900',
    navy: 'border-navy-200 bg-navy-50/30 text-navy-900',
  }[tone];

  return (
    <div className={`rounded-md border ${toneClass} p-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-xl font-bold">{value}</div>
      <div className="text-[10px] opacity-60">{sub}</div>
    </div>
  );
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return Math.round((left + right) / 2);
  }
  return sorted[mid] ?? 0;
}
