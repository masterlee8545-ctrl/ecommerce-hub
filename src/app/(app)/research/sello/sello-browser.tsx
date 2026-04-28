/**
 * 셀록홈즈 카테고리 소싱 — 클라이언트 UI
 *
 * 흐름:
 * 1. 대분류 드롭다운 선택 → /api/sellochomes?path=<대분류> → 중분류 트리 + 키워드(대분류 기준 로드)
 * 2. 중분류 선택 → 전체 경로 재조회 → 소분류 트리 확장 & 키워드 갱신
 * 3. 필터: 월간 검색량, 쿠팡 평균 리뷰수, 경쟁 지수
 * 4. 필터 통과한 키워드 체크 → "장바구니 담기"
 */
'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, Loader2, Plus, ShoppingCart, StopCircle, X } from 'lucide-react';
import { toast } from 'sonner';

import { bulkAddToBasketAction } from '@/lib/products/actions';

interface TreeLevel {
  level: number;
  reps: string;
  items: Array<{ name: string; id: string }>;
}

interface Keyword {
  keyword: string;
  wholeCategoryName: string;
  totalItemCounts: number;
  avgPrice: number | null;
  c_pCnt: number;
  c_avgPrice: number | null;
  c_avgReviewCnt: number;
  c_maxReviewCnt: number;
  c_rocketRatio: number;
  compIdx: string | null;
  competition: number;
  monthlyQcCnt: number;
  estimatedQcCnt: number;
  seasonality: string;
  isBrandKey: number;
  isCommerceKey: number;
}

/** /api/sellochomes/keyword-reviews 응답의 distribution 형태 (server 와 동기화) */
interface ReviewDistResult {
  keyword: string;
  totalProducts: number;
  realProducts: number;
  underThresholdCount: number;
  underThresholdRatio: number;
  isMajority: boolean;
  threshold: number;
  majorityCount: number;
  reviewCounts: number[];
}

/** 정렬 가능한 칼럼 키 */
type SortColumn =
  | 'searchVolume'   // 월검색
  | 'competition'    // 경쟁
  | 'avgReview'      // 쿠팡 리뷰 (평균)
  | 'maxReview'      // 쿠팡 리뷰 (최대)
  | 'reviewDist'     // 리뷰 분포 (<500 개수)
  | 'rocketRatio'    // 쿠팡 로켓%
  | 'productCount'   // 쿠팡 상품수
  | 'avgPrice';      // 평균가

interface ApiResponse {
  ok: true;
  categoryId: string | null;
  path: string;
  tree: TreeLevel[];
  keywords: Keyword[] | null;
}

interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

const PERCENT = 100;
const DEFAULT_MIN_SEARCH = 5000;
const DEFAULT_MAX_SEARCH = 100000;
const DEFAULT_MAX_COUPANG_REVIEW = 500;

// 리뷰 분포 분석 결과 — F5 새로고침 후에도 유지되도록 localStorage 저장.
// 셀록홈즈 사용량(550/월) 절약 측면에서도 유리. 만료 없이 영구 저장 — 재분석은
// 명시적으로 다시 버튼 누를 때만 (사용량 보호).
const REVIEW_DIST_STORAGE_KEY = 'sellochomes:reviewDistributions:v1';

function loadStoredDistributions(): Record<string, ReviewDistResult> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REVIEW_DIST_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ReviewDistResult>;
  } catch {
    return {};
  }
}

function saveOneDistribution(keyword: string, dist: ReviewDistResult): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadStoredDistributions();
    cur[keyword] = dist;
    window.localStorage.setItem(REVIEW_DIST_STORAGE_KEY, JSON.stringify(cur));
  } catch {
    // QuotaExceeded 등 — 메모리에는 유지되니 조용히 무시
  }
}

export function SelloBrowser({
  targetCompanyId,
  userCompanies,
}: {
  targetCompanyId: string;
  userCompanies: Array<{ id: string; name: string }>;
}) {
  const [tree, setTree] = useState<TreeLevel[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // ['식품', '농산물', '과일', …]
  // 현재 드릴다운으로 미리보는 키워드 (아직 누적 안 된 상태). 누적 X 면 이게 표 source.
  const [previewKeywords, setPreviewKeywords] = useState<Keyword[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 누적 카테고리 — 여러 카테고리 키워드를 합쳐서 보여줌.
  // key = 카테고리 path 문자열 (예: "식품>농산물>과일") / value = 그 카테고리 키워드 배열.
  // 비어있으면 previewKeywords (단일 모드) 가 표 source. 1개 이상 있으면 누적 모드.
  const [categoryStore, setCategoryStore] = useState<Map<string, Keyword[]>>(new Map());

  // 필터
  const [minSearch, setMinSearch] = useState<number>(DEFAULT_MIN_SEARCH);
  const [maxSearch, setMaxSearch] = useState<number>(DEFAULT_MAX_SEARCH);
  const [maxCoupangReview, setMaxCoupangReview] = useState<number>(DEFAULT_MAX_COUPANG_REVIEW);
  const [excludeBrand, setExcludeBrand] = useState(true);
  // 추가 필터 — 빈 칸 ('') 이면 미적용
  const [maxCompetition, setMaxCompetition] = useState<string>('');
  const [maxCoupangMaxReview, setMaxCoupangMaxReview] = useState<string>('');
  const [maxRocketRatio, setMaxRocketRatio] = useState<string>(''); //  0~100 (%)
  const [minAvgPrice, setMinAvgPrice] = useState<string>('');
  const [maxAvgPrice, setMaxAvgPrice] = useState<string>('');
  const [minReviewDistUnder500, setMinReviewDistUnder500] = useState<string>(''); //  분석된 키워드만 적용

  // 선택 (체크박스)
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [selectedCompanyId, setSelectedCompanyId] = useState(targetCompanyId);

  // 리뷰 분포 분석 결과 (사용자 핵심 use case: <500 리뷰가 10개 이상인지)
  // 키: 키워드 / 값: 'pending' = 분석중, 'error' = 실패, 객체 = 성공
  const [reviewDist, setReviewDist] = useState<
    Map<string, 'pending' | 'error' | ReviewDistResult>
  >(new Map());
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  // 정지 신호 — useState 쓰면 closure 에 갇혀 루프가 못 봄. ref 로 즉시 반영.
  const stopRequestedRef = useRef(false);

  // Shift+클릭 범위 선택용 — 마지막 클릭한 행의 (sortedFiltered 기준) index
  const lastClickedIdxRef = useRef<number | null>(null);

  // 정렬 상태 (null = 기본 순서 / 셀록홈즈가 준 순서)
  const [sortBy, setSortBy] = useState<{
    column: SortColumn;
    direction: 'asc' | 'desc';
  } | null>(null);

  // 마운트 시 localStorage 에서 이전 분석 결과 복원 (F5 후에도 유지)
  useEffect(() => {
    const stored = loadStoredDistributions();
    if (Object.keys(stored).length === 0) return;
    setReviewDist(new Map(Object.entries(stored)));
  }, []);

  // 칼럼 헤더 클릭 → 정렬 토글 (asc → desc → 해제)
  function toggleSort(column: SortColumn): void {
    setSortBy((prev) => {
      if (!prev || prev.column !== column) return { column, direction: 'desc' };
      if (prev.direction === 'desc') return { column, direction: 'asc' };
      return null; // 같은 칼럼 3번째 클릭 → 정렬 해제 (원래 순서)
    });
  }

  // ── 초기 로드 (대분류만) ──
  useEffect(() => {
    void load('');
  }, []);

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sellochomes?path=${encodeURIComponent(path)}`);
      const body = (await res.json()) as ApiResponse | ApiError;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setTree(body.tree);
      setPreviewKeywords(body.keywords);
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }

  function onSelectLevel(level: number, name: string) {
    const next = [...selected.slice(0, level), name];
    setSelected(next);
    void load(next.join('>'));
  }

  function clearFromLevel(level: number) {
    const next = selected.slice(0, level);
    setSelected(next);
    void load(next.join('>'));
  }

  // 현재 드릴다운한 카테고리를 누적 store 에 추가.
  // 추가 후 드릴다운은 최상위로 리셋 → 다음 카테고리 골라서 누적 가능.
  function addCurrentCategoryToStore(): void {
    const path = selected.join('>');
    if (!path || !previewKeywords || previewKeywords.length === 0) return;
    setCategoryStore((prev) => {
      const next = new Map(prev);
      next.set(path, previewKeywords);
      return next;
    });
    // 드릴다운 리셋 — 다음 카테고리 고르러
    setSelected([]);
    setPreviewKeywords(null);
    void load('');
  }

  function removeCategoryFromStore(path: string): void {
    setCategoryStore((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }

  function clearAllCategories(): void {
    setCategoryStore(new Map());
  }

  // 누적 store 가 있으면 머지된 키워드, 없으면 단일 드릴다운 미리보기.
  const mergedKeywords = useMemo<Keyword[] | null>(() => {
    if (categoryStore.size === 0) return previewKeywords;
    const map = new Map<string, Keyword>();
    for (const kws of categoryStore.values()) {
      for (const k of kws) {
        if (!map.has(k.keyword)) map.set(k.keyword, k);
      }
    }
    return Array.from(map.values());
  }, [categoryStore, previewKeywords]);

  // ── 리뷰 분포 분석 (사장님 핵심 use case) ──
  // 키워드 1개당 셀록홈즈 사용량 1회 차감.
  // 성공 시 localStorage 에도 저장 → F5 후에도 유지.
  async function analyzeOne(keyword: string): Promise<void> {
    setReviewDist((prev) => {
      const next = new Map(prev);
      next.set(keyword, 'pending');
      return next;
    });
    try {
      const res = await fetch(
        `/api/sellochomes/keyword-reviews?keyword=${encodeURIComponent(keyword)}`,
      );
      const body = (await res.json()) as
        | { ok: true; distribution: ReviewDistResult }
        | { ok: false; error: string };
      setReviewDist((prev) => {
        const next = new Map(prev);
        if (body.ok) {
          next.set(keyword, body.distribution);
          saveOneDistribution(keyword, body.distribution);
        } else {
          next.set(keyword, 'error');
        }
        return next;
      });
    } catch {
      setReviewDist((prev) => {
        const next = new Map(prev);
        next.set(keyword, 'error');
        return next;
      });
    }
  }

  // 필터 통과한 키워드 일괄 분석 — 순차 호출 (사용량 한 번에 다 쓰지 않게).
  // 이미 분석된 건 스킵. 정지 버튼 눌리면 즉시 break (다음 키워드부터 안 함).
  async function analyzeAllFiltered(targets: Keyword[]): Promise<void> {
    const pending = targets.filter((k) => {
      const cur = reviewDist.get(k.keyword);
      return cur === undefined || cur === 'error';
    });
    if (pending.length === 0) return;

    if (
      !window.confirm(
        `${pending.length}개 키워드 분석 — 셀록홈즈 사용량 ${pending.length}회 차감됩니다. 진행할까요?`,
      )
    ) {
      return;
    }

    stopRequestedRef.current = false;
    setBulkAnalyzing(true);
    setBulkProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      if (stopRequestedRef.current) {
        // 사용자가 정지 누름 — 다음 키워드부터 안 함 (현재 진행 중인 건 어차피 await 끝남)
        break;
      }
      const target = pending[i];
      if (!target) continue;
      // 순차 — sello rate-limit 방지
      // eslint-disable-next-line no-await-in-loop
      await analyzeOne(target.keyword);
      setBulkProgress({ done: i + 1, total: pending.length });
    }
    setBulkAnalyzing(false);
    stopRequestedRef.current = false;
  }

  // 빈 문자열 / NaN 인 필터값은 미적용 (number 변환 가드)
  function asNumberOrNull(s: string): number | null {
    const n = Number(s);
    return s.trim() === '' || Number.isNaN(n) ? null : n;
  }

  // ── 필터 적용 ──
  const filtered = useMemo(() => {
    if (!mergedKeywords) return [];
    const fMaxComp = asNumberOrNull(maxCompetition);
    const fMaxMaxRev = asNumberOrNull(maxCoupangMaxReview);
    const fMaxRocket = asNumberOrNull(maxRocketRatio); // 0~100
    const fMinPrice = asNumberOrNull(minAvgPrice);
    const fMaxPrice = asNumberOrNull(maxAvgPrice);
    const fMinDistUnder = asNumberOrNull(minReviewDistUnder500);

    return mergedKeywords.filter((k) => {
      if (k.monthlyQcCnt < minSearch) return false;
      if (k.monthlyQcCnt > maxSearch) return false;
      if (k.c_avgReviewCnt > maxCoupangReview) return false;
      if (excludeBrand && k.isBrandKey === 1) return false;
      if (fMaxComp !== null && k.competition > fMaxComp) return false;
      if (fMaxMaxRev !== null && k.c_maxReviewCnt > fMaxMaxRev) return false;
      if (fMaxRocket !== null && k.c_rocketRatio * PERCENT > fMaxRocket) return false;
      if (fMinPrice !== null && (k.c_avgPrice ?? 0) < fMinPrice) return false;
      if (fMaxPrice !== null && (k.c_avgPrice ?? 0) > fMaxPrice) return false;
      // 리뷰 분포 필터: 분석된 키워드만 적용. 미분석은 통과 (사용자가 별도로 분석 후 평가).
      if (fMinDistUnder !== null) {
        const d = reviewDist.get(k.keyword);
        if (typeof d === 'object' && d.underThresholdCount < fMinDistUnder) return false;
      }
      return true;
    });
  }, [
    mergedKeywords,
    minSearch,
    maxSearch,
    maxCoupangReview,
    excludeBrand,
    maxCompetition,
    maxCoupangMaxReview,
    maxRocketRatio,
    minAvgPrice,
    maxAvgPrice,
    minReviewDistUnder500,
    reviewDist,
  ]);

  // ── 정렬 적용 (필터 다음 단계) ──
  // sortBy 가 null 이면 필터 결과 순서 그대로 (= 셀록홈즈 기본 정렬)
  const sortedFiltered = useMemo(() => {
    if (!sortBy) return filtered;
    const dir = sortBy.direction === 'asc' ? 1 : -1;

    function valueOf(k: Keyword): number {
      switch (sortBy!.column) {
        case 'searchVolume':
          return k.monthlyQcCnt;
        case 'competition':
          return k.competition;
        case 'avgReview':
          return k.c_avgReviewCnt;
        case 'maxReview':
          return k.c_maxReviewCnt;
        case 'reviewDist': {
          // 분석 안 된 키워드는 항상 끝으로 (정렬 방향 무관하게 sentinel)
          const dist = reviewDist.get(k.keyword);
          if (typeof dist !== 'object') return Number.NEGATIVE_INFINITY * dir;
          return dist.underThresholdCount;
        }
        case 'rocketRatio':
          return k.c_rocketRatio;
        case 'productCount':
          return k.c_pCnt;
        case 'avgPrice':
          return k.c_avgPrice ?? 0;
        default:
          return 0;
      }
    }

    return [...filtered].sort((a, b) => (valueOf(a) - valueOf(b)) * dir);
  }, [filtered, sortBy, reviewDist]);

  // Shift+클릭 범위 선택. 같은 행 두 번 클릭 또는 shift 없이 클릭은 단일 토글.
  function handleRowCheckboxClick(
    e: React.MouseEvent<HTMLInputElement>,
    keyword: string,
    index: number,
  ): void {
    if (e.shiftKey && lastClickedIdxRef.current !== null) {
      e.preventDefault();
      const start = Math.min(lastClickedIdxRef.current, index);
      const end = Math.max(lastClickedIdxRef.current, index);
      const rangeKw = sortedFiltered.slice(start, end + 1).map((k) => k.keyword);
      setSelectedKeywords((prev) => {
        const next = new Set(prev);
        // 범위 안이 모두 선택돼있으면 해제, 아니면 모두 선택
        const allSelected = rangeKw.every((kw) => next.has(kw));
        if (allSelected) rangeKw.forEach((kw) => next.delete(kw));
        else rangeKw.forEach((kw) => next.add(kw));
        return next;
      });
    } else {
      setSelectedKeywords((prev) => {
        const next = new Set(prev);
        if (next.has(keyword)) next.delete(keyword);
        else next.add(keyword);
        return next;
      });
    }
    lastClickedIdxRef.current = index;
  }

  const breadcrumb = selected.length > 0 ? selected.join(' > ') : '최상위';

  return (
    <div className="space-y-4">
      {/* 누적 카테고리 칩 — 1개 이상 추가됐을 때만 보임 */}
      {categoryStore.size > 0 && (
        <section className="rounded-lg border border-violet-200 bg-violet-50/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-violet-700">
              📌 누적된 카테고리 ({categoryStore.size}개)
            </span>
            <button
              type="button"
              onClick={clearAllCategories}
              className="text-[11px] text-navy-500 hover:text-red-600 hover:underline"
            >
              전체 비우기
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(categoryStore.entries()).map(([path, kws]) => (
              <span
                key={path}
                className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-2.5 py-1 text-xs text-navy-800"
              >
                <span>{path.replace(/>/g, ' › ')}</span>
                <span className="text-[10px] text-navy-400">({kws.length})</span>
                <button
                  type="button"
                  onClick={() => removeCategoryFromStore(path)}
                  className="ml-0.5 rounded-full text-navy-400 hover:bg-red-100 hover:text-red-600"
                  title="이 카테고리 제거"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-navy-500">
            💡 아래 드릴다운으로 더 추가할 수 있어요. 같은 키워드가 여러 카테고리에 있으면 한 번만 표시됩니다.
          </p>
        </section>
      )}

      {/* 카테고리 드릴다운 */}
      <section className="rounded-lg border border-navy-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-navy-700">📂 카테고리:</span>
          <button
            type="button"
            onClick={() => clearFromLevel(0)}
            className={
              selected.length === 0
                ? 'text-navy-400'
                : 'font-medium text-violet-700 hover:underline'
            }
          >
            전체
          </button>
          {selected.map((name, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="text-navy-300">›</span>
              <button
                type="button"
                onClick={() => clearFromLevel(i + 1)}
                className="font-medium text-violet-700 hover:underline"
              >
                {name}
              </button>
            </span>
          ))}
        </div>

        {/* 현재 레벨의 선택지 */}
        <div className="mt-4 space-y-3">
          {tree.map((lvl) => {
            const alreadyPicked = selected[lvl.level];
            if (alreadyPicked) return null; // 이미 선택된 레벨은 숨김
            return (
              <div key={lvl.level}>
                <div className="mb-1.5 text-xs font-semibold text-navy-500">
                  {lvl.level + 1}차 분류 · {lvl.reps} ({lvl.items.length}개)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {lvl.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => onSelectLevel(lvl.level, it.name)}
                      className="rounded-md border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {it.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 로딩 / 에러 */}
      {loading && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" /> 로딩 중...
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">오류: {error}</p>
            <p className="mt-1 text-xs text-red-600">
              세션 만료면 sellochomes.co.kr 재로그인 후 쿠키 재발급. 관리자에게 문의.
            </p>
          </div>
        </div>
      )}

      {/* 키워드 결과 */}
      {mergedKeywords !== null && (
        <section className="rounded-lg border border-navy-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-navy-900">
                📊{' '}
                {categoryStore.size > 0
                  ? `누적 ${categoryStore.size}개 카테고리`
                  : breadcrumb}
                {' '}— <span className="text-violet-700">{mergedKeywords.length}개</span> 전체
                {filtered.length < mergedKeywords.length && (
                  <span className="ml-1 text-sm text-navy-500">
                    / 필터 통과{' '}
                    <span className="font-bold text-emerald-700">{filtered.length}개</span>
                  </span>
                )}
              </h2>
            </div>
            {filtered.length > 0 && (
              <div className="flex items-center gap-2">
                {bulkAnalyzing && (
                  <span className="text-xs text-navy-500">
                    분석 중 {bulkProgress.done}/{bulkProgress.total}
                  </span>
                )}
                {/* 현재 드릴다운한 카테고리를 누적 store 에 추가 */}
                {selected.length > 0 && previewKeywords && previewKeywords.length > 0 && !bulkAnalyzing && (
                  <button
                    type="button"
                    onClick={addCurrentCategoryToStore}
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-400 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                    title={`"${breadcrumb}" 카테고리를 누적 목록에 추가. 드릴다운은 최상위로 리셋됩니다 — 이어서 다른 카테고리도 추가 가능.`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    이 카테고리 추가
                  </button>
                )}
                {bulkAnalyzing ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopRequestedRef.current = true;
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                    title="다음 키워드부터 분석 중단 (현재 진행 중인 1건은 끝까지 마침)"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    정지
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const targets = sortedFiltered.filter((k) =>
                        selectedKeywords.has(k.keyword),
                      );
                      void analyzeAllFiltered(targets);
                    }}
                    disabled={selectedKeywords.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-navy-300"
                    title={
                      selectedKeywords.size === 0
                        ? '먼저 분석할 키워드를 체크박스로 선택하세요 (사용량 보호 — 명시적으로 선택한 것만 처리).'
                        : `선택한 ${selectedKeywords.size}개 키워드 분석. 1키워드당 셀록홈즈 사용량 1회 차감 (이미 분석된 건 스킵).`
                    }
                  >
                    <span>🎯</span>
                    {selectedKeywords.size === 0
                      ? '선택한 키워드 일괄 분석'
                      : `선택한 ${selectedKeywords.size}개 일괄 분석`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 필터 — 빈 칸은 미적용. 모든 입력 필터는 AND 조건. */}
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-violet-50/40 p-3 text-xs md:grid-cols-4">
            <div>
              <label className="block font-semibold text-navy-700">월검색 ≥</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={minSearch}
                onChange={(e) => setMinSearch(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">월검색 ≤</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={maxSearch}
                onChange={(e) => setMaxSearch(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">경쟁 ≤ <span className="text-navy-400">(공란=무시)</span></label>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="예: 5"
                value={maxCompetition}
                onChange={(e) => setMaxCompetition(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">쿠팡 평균리뷰 ≤</label>
              <input
                type="number"
                min={0}
                step={50}
                value={maxCoupangReview}
                onChange={(e) => setMaxCoupangReview(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">쿠팡 최대리뷰 ≤ <span className="text-navy-400">(공란=무시)</span></label>
              <input
                type="number"
                min={0}
                step={500}
                placeholder="예: 5000"
                value={maxCoupangMaxReview}
                onChange={(e) => setMaxCoupangMaxReview(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">쿠팡 로켓% ≤ <span className="text-navy-400">(공란=무시)</span></label>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                placeholder="예: 30"
                value={maxRocketRatio}
                onChange={(e) => setMaxRocketRatio(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">평균가 ≥ <span className="text-navy-400">(공란=무시)</span></label>
              <input
                type="number"
                min={0}
                step={1000}
                placeholder="예: 10000"
                value={minAvgPrice}
                onChange={(e) => setMinAvgPrice(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-navy-700">평균가 ≤ <span className="text-navy-400">(공란=무시)</span></label>
              <input
                type="number"
                min={0}
                step={1000}
                placeholder="예: 100000"
                value={maxAvgPrice}
                onChange={(e) => setMaxAvgPrice(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div title="분석된 키워드만 적용 (미분석은 통과). 예: 10 이면 '500미만이 10개 이상' 키워드만.">
              <label className="block font-semibold text-navy-700">리뷰 분포 ≥ <span className="text-navy-400">(분석된 것만)</span></label>
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                placeholder="예: 10"
                value={minReviewDistUnder500}
                onChange={(e) => setMinReviewDistUnder500(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div className="col-span-2 flex items-end md:col-span-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludeBrand}
                  onChange={(e) => setExcludeBrand(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="font-semibold text-navy-700">브랜드 제외</span>
              </label>
            </div>
          </div>

          {/* 일괄 담기 */}
          {filtered.length > 0 && (
            <BulkAddForm
              keywords={filtered}
              userCompanies={userCompanies}
              selectedCompanyId={selectedCompanyId}
              onCompanyChange={setSelectedCompanyId}
              selectedKeywords={selectedKeywords}
              onSelectAll={() => setSelectedKeywords(new Set(filtered.map((k) => k.keyword)))}
              onClearSelection={() => setSelectedKeywords(new Set())}
            />
          )}

          {/* 사용 안내 */}
          {filtered.length > 0 && (
            <div className="mb-2 text-[11px] text-navy-400">
              💡 칼럼 헤더 클릭으로 정렬 (▲ 오름차순 / ▼ 내림차순). Shift+체크박스 클릭으로 범위 선택.
            </div>
          )}

          {/* 테이블 */}
          {filtered.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
              필터 조건에 맞는 키워드가 없습니다. 조건을 낮춰보세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-navy-200 text-navy-600">
                    <th className="px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={
                          filtered.length > 0
                          && filtered.every((k) => selectedKeywords.has(k.keyword))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedKeywords(new Set(filtered.map((k) => k.keyword)));
                          } else {
                            setSelectedKeywords(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 text-left">키워드</th>
                    <SortableTh label="월검색" column="searchVolume" align="right" sortBy={sortBy} onClick={toggleSort} />
                    <SortableTh label="경쟁" column="competition" align="right" sortBy={sortBy} onClick={toggleSort} />
                    <SortableTh
                      label={<>쿠팡 리뷰 <span className="text-[9px] font-normal text-navy-400">평균/최대</span></>}
                      column="avgReview"
                      align="right"
                      sortBy={sortBy}
                      onClick={toggleSort}
                      title="클릭으로 평균 기준 정렬. 평균/최대 — 차이가 크면 1~2개 큰 상품이 평균을 부풀린 상태."
                    />
                    <SortableTh
                      label={<>리뷰 분포 <span className="text-[9px] font-normal text-navy-400">&lt;500</span></>}
                      column="reviewDist"
                      align="center"
                      sortBy={sortBy}
                      onClick={toggleSort}
                      title="실제 1페이지 상품 중 리뷰 500미만 개수 — 10개 이상이면 진입 가능 시장. 미분석 키워드는 항상 끝."
                    />
                    <SortableTh label="쿠팡 로켓%" column="rocketRatio" align="right" sortBy={sortBy} onClick={toggleSort} />
                    <SortableTh label="쿠팡 상품수" column="productCount" align="right" sortBy={sortBy} onClick={toggleSort} />
                    <SortableTh label="평균가" column="avgPrice" align="right" sortBy={sortBy} onClick={toggleSort} />
                    <th className="px-2 py-2 text-left">계절성</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFiltered.map((k, idx) => {
                    const isSelected = selectedKeywords.has(k.keyword);
                    return (
                      <tr
                        key={k.keyword}
                        className={`border-b border-navy-100 hover:bg-violet-50/30 ${
                          isSelected ? 'bg-violet-50/50' : ''
                        }`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => handleRowCheckboxClick(e, k.keyword, idx)}
                            onChange={() => {
                              /* onClick 가 처리 — 여기서는 React controlled warning 방지용 */
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-semibold text-navy-900">
                          {k.keyword}
                          {k.isBrandKey === 1 && (
                            <span className="ml-1 rounded bg-amber-50 px-1 text-[9px] text-amber-700">브랜드</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {k.monthlyQcCnt.toLocaleString('ko-KR')}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span
                            className={
                              k.compIdx === '낮음'
                                ? 'text-emerald-700'
                                : k.compIdx === '높음'
                                  ? 'text-red-700'
                                  : 'text-navy-600'
                            }
                          >
                            {k.competition.toFixed(1)}
                            {k.compIdx && <span className="ml-0.5 text-[9px]">({k.compIdx})</span>}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {(() => {
                            const avg = k.c_avgReviewCnt;
                            const max = k.c_maxReviewCnt;
                            // skew = max 가 평균의 5배 넘으면 분포가 한쪽으로 쏠려있음.
                            //        평균만 보고 판단하면 잘못된 결론 → ⚠️ 표시.
                            const skewed = avg > 0 && max / avg >= 5;
                            const avgClass =
                              avg < DEFAULT_MAX_COUPANG_REVIEW
                                ? 'font-semibold text-emerald-700'
                                : 'text-navy-800';
                            return (
                              <span title={skewed ? '큰 상품 1~2개가 평균을 부풀린 상태 — 분석 버튼으로 실제 분포 확인 권장' : ''}>
                                <span className={avgClass}>{avg.toLocaleString('ko-KR')}</span>
                                <span className="mx-1 text-navy-300">/</span>
                                <span className="text-navy-500">{max.toLocaleString('ko-KR')}</span>
                                {skewed && <span className="ml-1 text-amber-600">⚠️</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {(() => {
                            const dist = reviewDist.get(k.keyword);
                            if (dist === 'pending') {
                              return <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-navy-400" />;
                            }
                            if (dist === 'error') {
                              return (
                                <button
                                  type="button"
                                  onClick={() => void analyzeOne(k.keyword)}
                                  className="text-[10px] text-red-600 hover:underline"
                                >
                                  ↻ 재시도
                                </button>
                              );
                            }
                            if (dist) {
                              const { underThresholdCount, realProducts, isMajority } = dist;
                              return (
                                <span
                                  className={
                                    isMajority
                                      ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700'
                                      : 'rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700'
                                  }
                                  title={
                                    isMajority
                                      ? `진입 가능: ${realProducts}개 중 ${underThresholdCount}개가 500미만 (10개 이상)`
                                      : `진입 어려움: ${realProducts}개 중 ${underThresholdCount}개만 500미만 (10개 미만)`
                                  }
                                >
                                  {isMajority ? '🟢' : '🔴'} {underThresholdCount}/{realProducts}
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => void analyzeOne(k.keyword)}
                                disabled={bulkAnalyzing}
                                className="rounded border border-navy-200 px-2 py-0.5 text-[10px] text-navy-600 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
                                title="셀록홈즈 사용량 1회 차감 — 실제 1페이지 상품 리뷰 분포 분석"
                              >
                                🎯 분석
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-navy-600">
                          {Math.round(k.c_rocketRatio * PERCENT)}%
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-navy-600">
                          {k.c_pCnt}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-navy-600">
                          {k.c_avgPrice ? `₩${k.c_avgPrice.toLocaleString('ko-KR')}` : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-left text-navy-600">
                          {k.seasonality === '있음' ? '📅' : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 정렬 가능 칼럼 헤더
// ─────────────────────────────────────────────────────────

function SortableTh({
  label,
  column,
  align,
  sortBy,
  onClick,
  title,
}: {
  label: React.ReactNode;
  column: SortColumn;
  align: 'left' | 'right' | 'center';
  sortBy: { column: SortColumn; direction: 'asc' | 'desc' } | null;
  onClick: (col: SortColumn) => void;
  title?: string;
}) {
  const active = sortBy?.column === column;
  const arrow = !active ? '↕' : sortBy.direction === 'asc' ? '▲' : '▼';
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-2 py-2 ${alignClass}`} title={title}>
      <button
        type="button"
        onClick={() => onClick(column)}
        className={`inline-flex items-center gap-1 hover:text-violet-700 ${
          active ? 'font-bold text-violet-700' : 'text-navy-600'
        }`}
      >
        <span>{label}</span>
        <span className={`text-[10px] ${active ? 'text-violet-700' : 'text-navy-300'}`}>{arrow}</span>
      </button>
    </th>
  );
}

// ─────────────────────────────────────────────────────────
// 선택한 키워드 일괄 장바구니
// ─────────────────────────────────────────────────────────

function BulkAddForm({
  keywords,
  userCompanies,
  selectedCompanyId,
  onCompanyChange,
  selectedKeywords,
  onSelectAll,
  onClearSelection,
}: {
  keywords: Keyword[];
  userCompanies: Array<{ id: string; name: string }>;
  selectedCompanyId: string;
  onCompanyChange: (id: string) => void;
  selectedKeywords: Set<string>;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const picked = Array.from(selectedKeywords);
  const count = picked.length;

  // 각 키워드별 description(셀록홈즈 메타) — picked 순서와 맞춤
  function buildDescription(k: Keyword): string {
    const lines: string[] = ['셀록홈즈 카테고리 소싱'];
    lines.push(`📊 월검색: ${k.monthlyQcCnt.toLocaleString('ko-KR')}`);
    lines.push(`🏆 경쟁: ${k.competition.toFixed(1)}${k.compIdx ? ` (${k.compIdx})` : ''}`);
    lines.push(
      `⭐ 쿠팡 리뷰: 평균 ${k.c_avgReviewCnt.toLocaleString('ko-KR')} / 최대 ${k.c_maxReviewCnt.toLocaleString('ko-KR')}`,
    );
    lines.push(`🚀 쿠팡 로켓: ${Math.round(k.c_rocketRatio * PERCENT)}%`);
    lines.push(`📦 쿠팡 상품수: ${k.c_pCnt}`);
    if (k.c_avgPrice) lines.push(`💰 쿠팡 평균가: ₩${k.c_avgPrice.toLocaleString('ko-KR')}`);
    if (k.seasonality === '있음') lines.push(`📅 계절성 있음`);
    return lines.join('\n');
  }

  const descriptionByKeyword = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of keywords) map.set(k.keyword, buildDescription(k));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50/30 p-3">
      <span className="text-sm font-semibold text-violet-900">
        ✓ 선택 {count}개 / 필터 통과 {keywords.length}개
      </span>
      <button
        type="button"
        onClick={onSelectAll}
        className="rounded border border-violet-300 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
      >
        전체 선택
      </button>
      {count > 0 && (
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-navy-500 hover:text-red-600"
        >
          해제
        </button>
      )}
      {userCompanies.length > 1 && (
        <select
          value={selectedCompanyId}
          onChange={(e) => onCompanyChange(e.target.value)}
          className="h-8 rounded-md border border-navy-200 bg-white px-2 text-xs"
        >
          {userCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {count > 0 && (
        <form
          action={(formData) => {
            const n = count;
            const loadingId = toast.loading(`${n}개 장바구니에 담는 중...`);
            startTransition(async () => {
              try {
                await bulkAddToBasketAction(formData);
                toast.success(`${n}개 장바구니에 담김 ✓`, {
                  id: loadingId,
                  description: '아래 장바구니 목록에서 확인하세요.',
                  duration: 4000,
                });
                onClearSelection();
                router.refresh(); // F5 없이 장바구니 즉시 반영
                // 페이지 아래 장바구니로 스크롤
                setTimeout(() => {
                  if (typeof document !== 'undefined') {
                    document
                      .querySelector('[data-basket-anchor]')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }, 300);
              } catch (err) {
                toast.error('담기 실패', {
                  id: loadingId,
                  description: err instanceof Error ? err.message : String(err),
                });
              }
            });
          }}
          className="ml-auto"
        >
          {picked.map((kw) => (
            <input key={`k-${kw}`} type="hidden" name="keywords" value={kw} />
          ))}
          {picked.map((kw) => (
            <input
              key={`d-${kw}`}
              type="hidden"
              name="descriptions"
              value={descriptionByKeyword.get(kw) ?? '셀록홈즈 카테고리 소싱'}
            />
          ))}
          <input type="hidden" name="memoPrefix" value="셀록홈즈 카테고리 소싱" />
          <input type="hidden" name="targetCompanyId" value={selectedCompanyId} />
          <input type="hidden" name="noRedirect" value="1" />
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShoppingCart className="h-3.5 w-3.5" />
            )}
            {isPending ? `담는 중... (${count}개 · 수 초 소요)` : `${count}개 장바구니 담기`}
          </button>
        </form>
      )}
    </div>
  );
}
