/**
 * 배치 분석 폼 — Supabase 큐 + 로컬 워커 방식
 *
 * 역할:
 * - 시작 버튼 → POST /api/batch-jobs (keywords + filter) → batchId 받음
 * - URL 에 ?batchId=&lt;id&gt; 저장 (탭 닫고 다시 열어도 이어서 볼 수 있음)
 * - 3초 주기로 GET /api/batch-jobs/<batchId> 폴링 → UI 업데이트
 * - 결과 row 에 필터 조건 평가해 passed 마킹
 * - 완료 후 "통과 N개 장바구니에 담기"
 *
 * 주의:
 * - 실제 스크래핑은 로컬 PC 의 `npm run sello:worker` 프로세스가 수행
 * - 워커가 안 돌아가면 job 은 영원히 pending 상태
 * - 화면에 워커 상태 힌트 표시 (pending 이 5분 이상이면 안내 메시지)
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from 'next/navigation';

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  ShoppingCart,
  Square,
  XCircle,
} from 'lucide-react';

import { bulkAddToBasketAction } from '@/lib/products/actions';
import {
  DEFAULT_BATCH_CONDITION,
  evaluateBatchFilter,
  type BatchFilterCondition,
  type BatchFilterResult,
} from '@/lib/research/batch-filter';

// ─────────────────────────────────────────────────────────
// 타입
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
  scrapedAt: string;
  cacheAgeMs: number;
  isStale: boolean;
}

type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

interface ApiJob {
  id: string;
  batch_id: string;
  keyword: string;
  status: JobStatus;
  result: FirstPageMetrics | null;
  error: string | null;
  cache_hit: boolean;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
}

interface ApiBatchResponse {
  ok: true;
  batchId: string;
  summary: {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
    cancelled: number;
  };
  jobs: ApiJob[];
}

interface DisplayItem {
  keyword: string;
  status: JobStatus | 'queued-local'; //  queued-local = 시작 전 로컬 상태
  metrics: FirstPageMetrics | null;
  filterResult: BatchFilterResult | null;
  error: string | null;
  durationMs: number | null;
  cacheHit: boolean;
  heartbeatAt: string | null;
  startedAt: string | null;
  /** 최초 enqueue 된 시각 (서버 기준). 경고 grace period 계산용 */
  requestedAt: string | null;
}

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const PERCENT_MULTIPLIER = 100;
const MS_PER_SEC = 1000;
const DEFAULT_MAX_ROCKET_RATIO = 0.3;
const DEFAULT_PRICE_MEDIAN_MIN = 10_000;
const DEFAULT_PRICE_MEDIAN_MAX = 30_000;
const DEFAULT_EARLY_STOP_COUNT = 5;
const POLL_INTERVAL_MS = 3000;
const SECONDS_PER_MINUTE = 60;
const WARN_STALE_MINUTES = 5;
const STALE_PENDING_WARN_MS = WARN_STALE_MINUTES * SECONDS_PER_MINUTE * MS_PER_SEC;
const BATCH_ID_DISPLAY_LEN = 8;
/**
 * 워커가 안 돌고 있다고 판단하는 유예 기간.
 * 배치 등록 직후부터 워커가 첫 job 을 claim 하는 데 보통 < 10s 걸림.
 * 60s 넘게 pending 만 있고 running 이 하나도 없으면 워커 의심.
 */
const WORKER_DOWN_GRACE_MS = SECONDS_PER_MINUTE * MS_PER_SEC;

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function BatchAnalysisForm({
  targetCompanyId,
  userCompanies,
}: {
  targetCompanyId: string;
  userCompanies: Array<{ id: string; name: string }>;
}) {
  const searchParams = useSearchParams();
  const urlBatchId = searchParams.get('batchId');
  const keywordsParam = searchParams.get('keywords') ?? '';
  // URL 쿼리에서 쿠팡 조건 prefill (/research 원클릭 진입 시)
  const urlReview = searchParams.get('review');
  const urlRatio = searchParams.get('ratio'); // % 단위 (예: 60)
  const urlAutoStart = searchParams.get('auto') === '1';

  const initialKeywords = useMemo(
    () =>
      keywordsParam
        .split(',')
        .map((k) => decodeURIComponent(k).trim())
        .filter((k) => k.length > 0),
    [keywordsParam],
  );

  // ── 조건 상태 ── URL 쿼리가 있으면 해당 값으로 prefill
  const [cond, setCond] = useState<BatchFilterCondition>(() => {
    const prefilled = { ...DEFAULT_BATCH_CONDITION };
    if (urlReview !== null && Number.isFinite(Number(urlReview))) {
      prefilled.reviewThreshold = Math.max(0, Number(urlReview));
    }
    if (urlRatio !== null && Number.isFinite(Number(urlRatio))) {
      prefilled.minBelowReviewRatio = Math.max(0, Math.min(100, Number(urlRatio))) / 100;
    }
    return prefilled;
  });
  const [ignoreCache, setIgnoreCache] = useState(false);
  const [earlyStopAt, setEarlyStopAt] = useState<number | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(targetCompanyId);

  // ── 실행 상태 ──
  const [batchId, setBatchId] = useState<string | null>(urlBatchId);
  const [items, setItems] = useState<DisplayItem[]>(() =>
    initialKeywords.map((kw) => ({
      keyword: kw,
      status: 'queued-local' as const,
      metrics: null,
      filterResult: null,
      error: null,
      durationMs: null,
      cacheHit: false,
      heartbeatAt: null,
      startedAt: null,
      requestedAt: null,
    })),
  );
  const [enqueuing, setEnqueuing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  // 직접 입력 키워드 (URL 쿼리가 없을 때 사용)
  const [directKeywordsText, setDirectKeywordsText] = useState('');
  // "N초 전" 을 1초마다 갱신하기 위한 틱 카운터 (폴링 중에만)
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!batchId) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [batchId]);

  // 카운트
  const passedCount = items.filter((i) => i.filterResult?.passed === true).length;
  const failedCount = items.filter(
    (i) => i.status === 'done' && i.filterResult?.passed === false,
  ).length;
  const errorCount = items.filter((i) => i.status === 'failed').length;
  const doneCount = passedCount + failedCount + errorCount;
  const totalCount = items.length;
  const running = batchId !== null && (
    items.some((i) => i.status === 'pending' || i.status === 'running')
  );

  // 유효한 키워드 계산 — URL 쿼리 우선, 없으면 textarea 에서
  const effectiveKeywords = useMemo(() => {
    if (initialKeywords.length > 0) return initialKeywords;
    return directKeywordsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [initialKeywords, directKeywordsText]);

  // ── 시작: POST /api/batch-jobs ──
  const start = useCallback(async () => {
    if (enqueuing || running) return;
    if (effectiveKeywords.length === 0) {
      setServerError('분석할 키워드를 한 개 이상 입력하세요.');
      return;
    }
    setEnqueuing(true);
    setServerError(null);

    try {
      const res = await fetch('/api/batch-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: effectiveKeywords,
          filterCond: cond,
          forceFresh: ignoreCache,
        }),
      });
      const body = (await res.json()) as
        | { ok: true; batchId: string; enqueued: number }
        | { ok: false; error: string };
      if (!body.ok) {
        setServerError(body.error);
        return;
      }
      // URL 에 batchId 저장 (탭 닫아도 복원 가능)
      setBatchId(body.batchId);
      const url = new URL(window.location.href);
      url.searchParams.set('batchId', body.batchId);
      url.searchParams.delete('keywords'); // 더 이상 필요 없음
      window.history.replaceState(null, '', url.toString());
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setEnqueuing(false);
    }
  }, [enqueuing, running, effectiveKeywords, cond, ignoreCache]);

  // ── 자동 시작: URL 쿼리 auto=1 이면 마운트 후 한 번만 start() ──
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!urlAutoStart) return;
    if (autoStartedRef.current) return;
    if (batchId) return; // 이미 배치 진행 중
    if (initialKeywords.length === 0) return;
    autoStartedRef.current = true;
    void start();
  }, [urlAutoStart, batchId, initialKeywords.length, start]);

  // ── 중단: DELETE /api/batch-jobs/:id (pending 만 cancelled) ──
  const stop = useCallback(async () => {
    if (!batchId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/batch-jobs/${batchId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('[batch] cancel 실패:', err);
    } finally {
      setCancelling(false);
    }
  }, [batchId, cancelling]);

  // ── 폴링: batchId 가 있으면 3초마다 상태 갱신 ──
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!batchId) return;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/batch-jobs/${batchId}`);
        const body = (await res.json()) as
          | ApiBatchResponse
          | { ok: false; error: string };
        if (!('ok' in body) || !body.ok) {
          setServerError(('error' in body ? body.error : '폴링 실패'));
          return;
        }
        // API → DisplayItem 매핑 + 필터 평가
        const mapped: DisplayItem[] = body.jobs.map((j) => {
          const metrics = j.result;
          const filterResult =
            j.status === 'done' && metrics
              ? evaluateBatchFilter(metrics, cond)
              : null;
          const durationMs =
            j.started_at && j.completed_at
              ? new Date(j.completed_at).getTime()
                - new Date(j.started_at).getTime()
              : null;
          return {
            keyword: j.keyword,
            status: j.status,
            metrics,
            filterResult,
            error: j.error,
            durationMs,
            cacheHit: j.cache_hit,
            heartbeatAt: j.last_heartbeat_at,
            startedAt: j.started_at,
            requestedAt: j.requested_at,
          };
        });
        setItems(mapped);
        setLastPolledAt(new Date());

        // 조기 종료 체크 — 통과 개수 도달하면 나머지 pending 취소
        if (
          earlyStopAt !== null
          && mapped.filter((m) => m.filterResult?.passed === true).length >= earlyStopAt
          && mapped.some((m) => m.status === 'pending')
        ) {
          await fetch(`/api/batch-jobs/${batchId}`, { method: 'DELETE' });
        }
      } catch (err) {
        console.error('[batch] 폴링 에러:', err);
        setServerError(
          err instanceof Error ? `상태 갱신 실패: ${err.message}` : '상태 갱신 실패',
        );
      }
      // 완료된 경우 폴링 중단 (pending·running 0개)
    }

    // 즉시 한 번 + 주기적으로
    void tick();
    pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [batchId, cond, earlyStopAt]);

  // 자동 폴링 중단: items 가 들어온 후에만 판정 (빈 배열은 아직 첫 응답 전)
  useEffect(() => {
    if (!batchId) return;
    if (items.length === 0) return; // ← 첫 폴링 응답 기다리는 중
    const stillActive = items.some(
      (i) => i.status === 'pending' || i.status === 'running',
    );
    if (!stillActive && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [batchId, items]);

  // 키워드 소스 표시 (url 쿼리 vs 직접 입력)
  const usingDirectInput = initialKeywords.length === 0 && !batchId;

  // 워커 동작 확인 — 5분 이상 pending 이 있으면 경고
  const hasStaleRunning = items.some((i) => {
    if (i.status !== 'running') return false;
    if (!i.heartbeatAt) return false;
    return Date.now() - new Date(i.heartbeatAt).getTime() > STALE_PENDING_WARN_MS;
  });
  // 워커 의심 조건: pending 이 있고, 가장 오래된 pending 이 60s 넘게 대기,
  //                  그리고 running/done 이 하나도 없어야 함
  const oldestPendingRequestedAt = items
    .filter((i) => i.status === 'pending' && i.requestedAt)
    .map((i) => new Date(i.requestedAt!).getTime())
    .sort((a, b) => a - b)[0];
  const workerLikelyDown =
    batchId !== null
    && oldestPendingRequestedAt !== undefined
    && Date.now() - oldestPendingRequestedAt > WORKER_DOWN_GRACE_MS
    && items.every((i) => i.status !== 'running' && i.status !== 'done');

  return (
    <div className="space-y-6">
      {/* 키워드 입력 섹션 (URL 에 keywords 쿼리 없을 때만 노출) */}
      {usingDirectInput && (
        <section className="rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-navy-900">분석할 키워드 입력</h2>
          <p className="mb-3 text-sm leading-relaxed text-navy-600">
            쿠팡 1페이지 분석할 키워드를 <strong>줄바꿈</strong> 또는 <strong>쉼표</strong>로 구분해서 입력하세요 (최대 50개).
            <span className="ml-1 text-navy-500">또는 리서치 페이지에서 체크박스로 여러 개 선택해 넘어올 수도 있습니다.</span>
          </p>
          <textarea
            value={directKeywordsText}
            onChange={(e) => setDirectKeywordsText(e.target.value)}
            rows={5}
            placeholder={'실리콘장갑\n빨래건조대\n젖병솔'}
            disabled={enqueuing}
            className="block w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm font-mono text-navy-900 placeholder-navy-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-navy-50"
          />
          <p className="mt-2 text-xs text-navy-500">
            현재 {effectiveKeywords.length}개 입력됨
          </p>
        </section>
      )}

      {/* 조건 설정 */}
      {!batchId && (
        <section className="rounded-xl border border-navy-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-navy-900">통과 조건</h2>
          <ConditionGrid cond={cond} setCond={setCond} disabled={enqueuing} />
          <ExecutionOptions
            ignoreCache={ignoreCache}
            setIgnoreCache={setIgnoreCache}
            earlyStopAt={earlyStopAt}
            setEarlyStopAt={setEarlyStopAt}
            disabled={enqueuing}
          />
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={start}
              disabled={enqueuing || effectiveKeywords.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-sm transition hover:bg-blue-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enqueuing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Play className="h-5 w-5" />
              )}
              배치 분석 시작 ({effectiveKeywords.length}개)
            </button>
            <span className="text-sm text-navy-500">
              워커에 {effectiveKeywords.length}개 작업을 등록합니다. 탭을 닫아도 계속 진행.
            </span>
          </div>
        </section>
      )}

      {/* 진행 상태 헤더 — 배치 시작 후 */}
      {batchId && (
        <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-navy-900">
                배치 진행 중
                {!running && (
                  <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-sm font-semibold text-emerald-700">
                    완료
                  </span>
                )}
              </h2>
              <p className="mt-1 text-sm text-navy-600">
                배치 ID <code className="font-mono text-xs">{batchId.slice(0, BATCH_ID_DISPLAY_LEN)}</code> ·
                이 URL 은 나중에 다시 열어도 결과를 볼 수 있습니다.
              </p>
              {running && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-navy-500">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                  <span>
                    실시간 폴링 중
                    {lastPolledAt
                      ? ` · 마지막 갱신 ${Math.max(0, Math.floor((nowTick - lastPolledAt.getTime()) / 1000))}초 전`
                      : ' · 첫 응답 대기…'}
                  </span>
                </p>
              )}
            </div>
            {running && (
              <button
                type="button"
                onClick={stop}
                disabled={cancelling}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-red-300 bg-white px-5 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                {cancelling ? '취소 중...' : '남은 작업 취소'}
              </button>
            )}
          </div>
          <div className="mt-4">
            <ProgressSummary
              done={doneCount}
              total={totalCount}
              passed={passedCount}
              failed={failedCount}
              errors={errorCount}
            />
          </div>
          {workerLikelyDown && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ 워커가 작업을 집어가지 않는 것 같습니다. 로컬 PC 에서
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono">npm run sello:worker</code>
              실행 중인지 확인하세요.
            </div>
          )}
          {hasStaleRunning && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ 일부 작업의 heartbeat 가 끊겼습니다. 워커가 크래시했을 수 있으며 5분 내로 자동 복구됩니다.
            </div>
          )}
        </section>
      )}

      {/* 서버 에러 */}
      {serverError && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
          <div className="text-base font-bold">오류</div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{serverError}</p>
        </div>
      )}

      {/* 결과 리스트 */}
      {items.length > 0 && (
        <section className="rounded-xl border border-navy-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-navy-900">
              키워드별 결과
              <span className="ml-2 text-sm font-normal text-navy-500">
                ({items.length}개)
              </span>
            </h2>
            {passedCount > 0 && !running && (
              <BulkAddForm
                passedKeywords={items
                  .filter((i) => i.filterResult?.passed === true)
                  .map((i) => i.keyword)}
                selectedCompanyId={selectedCompanyId}
                onCompanyChange={setSelectedCompanyId}
                userCompanies={userCompanies}
              />
            )}
          </div>
          <ul className="space-y-3">
            {items.map((item, idx) => (
              <ResultRow key={`${item.keyword}-${idx}`} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 조건 그리드 (이전 버전과 동일 — 추출)
// ─────────────────────────────────────────────────────────

function ConditionGrid({
  cond,
  setCond,
  disabled,
}: {
  cond: BatchFilterCondition;
  setCond: (c: BatchFilterCondition) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* 리뷰수 조건 */}
      <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-4">
        <div className="text-sm font-semibold text-navy-800">
          리뷰수 조건
          <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">필수</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-base text-navy-800">
          리뷰
          <input
            type="number"
            min="0"
            step="50"
            value={cond.reviewThreshold}
            onChange={(e) =>
              setCond({ ...cond, reviewThreshold: Number(e.target.value) || 0 })
            }
            disabled={disabled}
            className="h-10 w-24 rounded-md border border-navy-200 bg-white px-3 text-base font-semibold text-navy-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          미만인 상품이
          <input
            type="number"
            min="0"
            max="100"
            step="5"
            value={Math.round(cond.minBelowReviewRatio * PERCENT_MULTIPLIER)}
            onChange={(e) =>
              setCond({
                ...cond,
                minBelowReviewRatio: (Number(e.target.value) || 0) / PERCENT_MULTIPLIER,
              })
            }
            disabled={disabled}
            className="h-10 w-20 rounded-md border border-navy-200 bg-white px-3 text-base font-semibold text-navy-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          % 이상
        </div>
      </div>

      {/* 로켓 비율 상한 */}
      <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy-800">
          <input
            type="checkbox"
            checked={cond.maxRocketRatio !== null && cond.maxRocketRatio !== undefined}
            onChange={(e) =>
              setCond({
                ...cond,
                maxRocketRatio: e.target.checked ? DEFAULT_MAX_ROCKET_RATIO : null,
              })
            }
            disabled={disabled}
            className="h-4 w-4 rounded border-navy-300 text-blue-600 focus:ring-blue-500"
          />
          로켓 비율 상한
          <span className="ml-1 rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold text-navy-500">선택</span>
        </label>
        {cond.maxRocketRatio !== null && cond.maxRocketRatio !== undefined && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-base text-navy-800">
            로켓 비율
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={Math.round(cond.maxRocketRatio * PERCENT_MULTIPLIER)}
              onChange={(e) =>
                setCond({
                  ...cond,
                  maxRocketRatio: (Number(e.target.value) || 0) / PERCENT_MULTIPLIER,
                })
              }
              disabled={disabled}
              className="h-10 w-20 rounded-md border border-navy-200 bg-white px-3 text-base font-semibold text-navy-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            % 이하
          </div>
        )}
      </div>

      {/* 가격 중앙값 범위 */}
      <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-4 md:col-span-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy-800">
          <input
            type="checkbox"
            checked={
              cond.priceMedianMin !== null || cond.priceMedianMax !== null
            }
            onChange={(e) =>
              setCond({
                ...cond,
                priceMedianMin: e.target.checked ? DEFAULT_PRICE_MEDIAN_MIN : null,
                priceMedianMax: e.target.checked ? DEFAULT_PRICE_MEDIAN_MAX : null,
              })
            }
            disabled={disabled}
            className="h-4 w-4 rounded border-navy-300 text-blue-600 focus:ring-blue-500"
          />
          가격 중앙값 범위
          <span className="ml-1 rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold text-navy-500">선택</span>
        </label>
        {(cond.priceMedianMin !== null || cond.priceMedianMax !== null) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-base text-navy-800">
            <span className="font-mono">₩</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={cond.priceMedianMin ?? ''}
              onChange={(e) =>
                setCond({
                  ...cond,
                  priceMedianMin: e.target.value ? Number(e.target.value) : null,
                })
              }
              disabled={disabled}
              placeholder="최소"
              className="h-10 w-32 rounded-md border border-navy-200 bg-white px-3 text-base font-semibold text-navy-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            ~
            <input
              type="number"
              min="0"
              step="1000"
              value={cond.priceMedianMax ?? ''}
              onChange={(e) =>
                setCond({
                  ...cond,
                  priceMedianMax: e.target.value ? Number(e.target.value) : null,
                })
              }
              disabled={disabled}
              placeholder="최대"
              className="h-10 w-32 rounded-md border border-navy-200 bg-white px-3 text-base font-semibold text-navy-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            원 사이
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionOptions({
  ignoreCache,
  setIgnoreCache,
  earlyStopAt,
  setEarlyStopAt,
  disabled,
}: {
  ignoreCache: boolean;
  setIgnoreCache: (v: boolean) => void;
  earlyStopAt: number | null;
  setEarlyStopAt: (v: number | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-navy-100 pt-4 text-sm text-navy-700">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={ignoreCache}
          onChange={(e) => setIgnoreCache(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-navy-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="font-medium">캐시 무시하고 새로 스크래핑</span>
        <span className="text-xs text-navy-400">(느리지만 최신)</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={earlyStopAt !== null}
          onChange={(e) => setEarlyStopAt(e.target.checked ? DEFAULT_EARLY_STOP_COUNT : null)}
          disabled={disabled}
          className="h-4 w-4 rounded border-navy-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="font-medium">조기 종료</span>
      </label>
      {earlyStopAt !== null && (
        <div className="flex items-center gap-2 text-sm">
          통과
          <input
            type="number"
            min="1"
            value={earlyStopAt}
            onChange={(e) => setEarlyStopAt(Math.max(1, Number(e.target.value) || 1))}
            disabled={disabled}
            className="h-9 w-16 rounded-md border border-navy-200 bg-white px-2 text-center text-base font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          개 나오면 자동 취소
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 진행 상태 요약
// ─────────────────────────────────────────────────────────

function ProgressSummary({
  done,
  total,
  passed,
  failed,
  errors,
}: {
  done: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * PERCENT_MULTIPLIER) : 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xl font-bold text-navy-900">
          {done}
          <span className="text-navy-400">/{total}</span>
        </span>
        <span className="text-navy-500">완료</span>
        <span className="font-mono text-xs text-navy-400">({pct}%)</span>
      </div>
      <div className="h-5 w-px bg-navy-200" />
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="font-bold text-emerald-700">{passed}</span>
          <span className="text-navy-500">통과</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="font-bold text-amber-700">{failed}</span>
          <span className="text-navy-500">탈락</span>
        </span>
        {errors > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="font-bold text-red-700">{errors}</span>
            <span className="text-navy-500">오류</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 행
// ─────────────────────────────────────────────────────────

function ResultRow({ item }: { item: DisplayItem }) {
  const statusBadge = (() => {
    switch (item.status) {
      case 'queued-local':
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-navy-100 px-2.5 py-1 text-xs font-medium text-navy-500">
            <Clock className="h-3.5 w-3.5" /> 대기 중
          </span>
        );
      case 'running': {
        const elapsed = item.startedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(item.startedAt).getTime()) / 1000))
          : 0;
        const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const ss = String(elapsed % 60).padStart(2, '0');
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 워커 처리 중 ({mm}:{ss})
          </span>
        );
      }
      case 'done':
        return item.filterResult?.passed ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> 통과
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
            <XCircle className="h-3.5 w-3.5" /> 탈락
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
            <AlertCircle className="h-3.5 w-3.5" /> 오류
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-navy-100 px-2.5 py-1 text-xs font-medium text-navy-500">
            취소됨
          </span>
        );
    }
  })();

  const passed = item.filterResult?.passed === true;

  return (
    <li
      className={`rounded-lg border-2 p-4 transition ${
        passed
          ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
          : item.status === 'failed'
            ? 'border-red-200 bg-red-50/40'
            : item.status === 'running'
              ? 'border-blue-300 bg-blue-50/40'
              : item.status === 'cancelled'
                ? 'border-navy-100 bg-navy-50/40 opacity-60'
                : 'border-navy-100 bg-white'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-navy-900">{item.keyword}</span>
            {statusBadge}
            {item.cacheHit && (
              <span className="rounded-md bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
                📦 캐시
              </span>
            )}
            {item.metrics?.isStale === true && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700" title="24시간 이상 지난 캐시">
                오래됨
              </span>
            )}
            {item.durationMs !== null && (item.status === 'done' || item.status === 'failed') && (
              <span className="ml-auto rounded-md bg-navy-50 px-2 py-0.5 font-mono text-xs text-navy-500">
                {Math.round(item.durationMs / MS_PER_SEC)}s
              </span>
            )}
          </div>

          {/* 메트릭 요약 */}
          {item.metrics && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <Metric
                label="리뷰 300↓"
                value={`${item.filterResult?.belowReviewCount ?? 0}/${item.metrics.rowCount}`}
                sub={`${
                  item.filterResult
                    ? Math.round(item.filterResult.belowReviewRatio * PERCENT_MULTIPLIER)
                    : 0
                }%`}
                emphasis={item.filterResult?.checks.reviewPassed ? 'good' : 'bad'}
              />
              <Metric
                label="로켓"
                value={`${Math.round(item.metrics.rocketRatio * PERCENT_MULTIPLIER)}%`}
                emphasis={
                  item.filterResult?.checks.rocketPassed === false
                    ? 'bad'
                    : 'neutral'
                }
              />
              {item.metrics.priceStats.median !== null && (
                <Metric
                  label="가격 중앙"
                  value={`₩${item.metrics.priceStats.median.toLocaleString('ko-KR')}`}
                  emphasis={
                    item.filterResult?.checks.pricePassed === false
                      ? 'bad'
                      : 'neutral'
                  }
                />
              )}
            </div>
          )}
        </div>

        {/* 상세 링크 */}
        {item.metrics && (
          <a
            href={`/research/coupang-first-page?keyword=${encodeURIComponent(item.keyword)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-navy-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50"
          >
            상세 →
          </a>
        )}
      </div>

      {item.filterResult && !item.filterResult.passed && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
          <span className="font-semibold">탈락 사유:</span> {item.filterResult.failReason}
        </div>
      )}

      {item.error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-sm text-red-700">
          {item.error}
        </div>
      )}
    </li>
  );
}

function Metric({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis: 'good' | 'bad' | 'neutral';
}) {
  const colorClass =
    emphasis === 'good'
      ? 'text-emerald-700'
      : emphasis === 'bad'
        ? 'text-amber-700'
        : 'text-navy-800';
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </span>
      <span className={`text-lg font-bold ${colorClass}`}>
        {value}
        {sub && (
          <span className="ml-1.5 text-sm font-medium text-navy-500">({sub})</span>
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 통과 키워드 일괄 장바구니 담기
// ─────────────────────────────────────────────────────────

function BulkAddForm({
  passedKeywords,
  selectedCompanyId,
  onCompanyChange,
  userCompanies,
}: {
  passedKeywords: string[];
  selectedCompanyId: string;
  onCompanyChange: (id: string) => void;
  userCompanies: Array<{ id: string; name: string }>;
}) {
  return (
    <form action={bulkAddToBasketAction} className="flex flex-wrap items-center gap-2">
      {passedKeywords.map((kw) => (
        <input key={kw} type="hidden" name="keywords" value={kw} />
      ))}
      <input type="hidden" name="memoPrefix" value="배치 분석 통과 (리뷰 조건 만족)" />

      {userCompanies.length > 1 && (
        <select
          name="targetCompanyId"
          value={selectedCompanyId}
          onChange={(e) => onCompanyChange(e.target.value)}
          className="h-10 rounded-md border border-navy-200 bg-white px-3 text-sm font-medium text-navy-800 focus:border-emerald-500 focus:outline-none"
        >
          {userCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {userCompanies.length <= 1 && (
        <input type="hidden" name="targetCompanyId" value={selectedCompanyId} />
      )}
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 hover:shadow"
      >
        <ShoppingCart className="h-4 w-4" />
        통과 {passedKeywords.length}개 장바구니에 담기
      </button>
    </form>
  );
}

