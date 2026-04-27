/**
 * 아이템 스카우트 카테고리 브라우저 (클라이언트 컴포넌트)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 쿠팡 카테고리 대분류 → 중분류 → 키워드 탐색
 * - 키워드별 검색량, 상품수, 쿠팡 경쟁강도 표시
 * - "장바구니에 담기" → quickAddToBasketAction 호출
 *
 * 흐름:
 * 1. 대분류 카테고리 카드 표시
 * 2. 클릭 → 하위 카테고리 로드
 * 3. 리프 카테고리 클릭 → 트렌딩 키워드 로드
 * 4. 키워드 옆 "담기" 클릭 → 장바구니에 추가
 */
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import {
  ArrowDownUp,
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

interface Category {
  id: number;
  n: string;
  lv: number;
  cid: number;
  il: number;
  /** 실제 하위 카테고리 3개 이름 — 라벨 검증용 미리보기 */
  preview?: string[];
  /** 미리보기 로드 실패 메시지 */
  previewError?: string;
}

interface Subcategory {
  id: number;
  name: string;
  level: number;
  is_leaf: number;
}

interface Keyword {
  keyword: string;
  image: string;
  rank: number;
  monthly: {
    total: number;
    pc: number;
    mobile: number;
  } | null;
  prdCnt: number | null;
  // 쿠팡 데이터: 플랫 필드로 키워드에 직접 달려 있음
  coupangCompetitionRatio: string | null;
  coupangAveragePrice: number | null;
  coupangAverageReviewCount: number | null;
  coupangTotalProductCount: number | null;
}

interface BreadcrumbItem {
  id: number;
  name: string;
}

/** 법인 선택 드롭다운용 — research/page.tsx 에서 주입 */
export interface BrowserCompany {
  id: string;
  name: string;
  businessType: 'industrial' | 'agricultural' | 'other';
}

interface ItemScoutBrowserProps {
  /** 장바구니 추가 Server Action */
  addToBasketAction: (form: FormData) => void;
  /** 사용자가 속한 법인 목록 */
  userCompanies: BrowserCompany[];
  /** 현재 활성 법인 ID — 드롭다운 기본값 */
  activeCompanyId: string;
}

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

// 주의: ItemScout API 라벨과 정확히 일치해야 함.
const CATEGORY_ICONS: Record<string, string> = {
  '패션의류잡화': '👗',
  '패션잡화': '👜',
  '뷰티': '💄',
  '뷰티(스킨케어)': '💄',
  '뷰티(화장품)': '💄',
  '뷰티(향수)': '🌸',
  '출산/유아동': '🍼',
  '식품': '🍎',
  '주방용품': '🍳',
  '생활용품': '🧹',
  '홈인테리어/가구': '🛋️',
  '가전디지털': '📱',
  '스포츠/레저': '⚽',
  '취미/DIY/차': '🚗',
  '여행/체험': '✈️',
  '도서/음반/DVD': '📚',
  '완구/취미': '🎮',
  '문구/오피스': '✏️',
  '반려/애완용품': '🐾',
  '헬스/건강식품': '💊',
};

/**
 * ItemScout API (2026-04) 의 대분류 라벨 보정표.
 *
 * 배경: `coupang_categories_map` 이 내려주는 `n` 값과 `/{id}/subcategories`
 *       의 실제 하위 내용이 대부분 불일치. 사용자가 "식품" 을 클릭했는데
 *       PC/노트북 용품이 나오는 문제.
 *
 * 방침: 실제 하위 내용을 기반으로 수동 보정 (한 번에 가볍게). API 가 수정되면
 *       이 맵을 비우거나 개별 항목 제거.
 *
 * 조사 기반: scripts/itemscout-smoke.ts 출력 (2026-04 기준)
 */
const CORRECTED_CATEGORY_NAMES: Record<number, string> = {
  // 1: 패션의류잡화 — 라벨 맞음
  2: '패션잡화',         // API: 뷰티 → 실제: 양말/신발/가방
  3: '뷰티',             // API: 출산/유아동 → 실제: 스킨케어/선케어/클렌징
  4: '가전디지털',       // API: 식품 → 실제: 학습기기/게임기/PC
  5: '홈인테리어/가구',  // API: 주방용품 → 실제: 침실/거실/주방 가구
  6: '출산/유아동',      // API: 생활용품 → 실제: 분유/기저귀/물티슈
  7: '식품',             // API: 가구/홈데코 → 실제: 건강식품/다이어트/간편조리
  8: '스포츠/레저',      // API: 가전/디지털 → 실제: 당구/기타스포츠/등산
  9: '취미/DIY/차',      // API: 스포츠/레져 → 실제: 화방/자동차/수집품
  10: '여행/체험',       // API: 자동차용품 → 실제: 원데이클래스/국내여행/해외여행
  11: '뷰티(화장품)',    // API: 도서 → 실제: 화장품/향수/시계
  // 12: 문구/오피스 (빈 하위 — 라벨만 유지)
  // 13: 음반/DVD (빈 하위 — 라벨만 유지)
  14: '뷰티(스킨케어)',  // API: 완구/취미 → 실제: 스킨케어/메이크업/클렌징
  15: '뷰티(향수)',      // API: 반려/애완용품 → 실제: 여성향수/남성향수
};

/** 보정표가 있으면 보정된 이름, 없으면 원본 `n` */
function displayCategoryName(cat: { id: number; n: string }): string {
  return CORRECTED_CATEGORY_NAMES[cat.id] ?? cat.n;
}

const COMPETITION_THRESHOLD_LOW = 40;  // 0~100 스케일 (아이템스카우트 기준)
const COMPETITION_THRESHOLD_HIGH = 70;

const COMPETITION_LABELS: Record<string, string> = {
  low: '쉬움',
  medium: '보통',
  high: '어려움',
};


// ─────────────────────────────────────────────────────────
// API 호출
// ─────────────────────────────────────────────────────────

async function fetchAPI<T>(action: string, params?: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/itemscout?${query.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `API 오류 (${res.status})`);
  }
  const json = await res.json() as { data: T };
  return json.data;
}

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function ItemScoutBrowser({
  addToBasketAction,
  userCompanies,
  activeCompanyId,
}: ItemScoutBrowserProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'categories' | 'subcategories' | 'keywords'>('categories');
  const [addedKeywords, setAddedKeywords] = useState<Set<string>>(new Set());
  /** 배치 분석을 위한 다중 선택 (키워드 이름 기준) */
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  const toggleKeywordSelect = useCallback((keyword: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }, []);

  // Shift+클릭 — 범위 선택/해제 (첫 항목과 마지막 항목 사이 전체)
  const bulkToggleKeywords = useCallback((keywords: string[], shouldSelect: boolean) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      for (const k of keywords) {
        if (shouldSelect) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeywords(new Set());
  }, []);

  // 뷰 바뀌면 선택 초기화 (다른 카테고리 키워드 섞이지 않게)
  useEffect(() => {
    if (view !== 'keywords') setSelectedKeywords(new Set());
  }, [view]);

  // 대분류 로드 — preview 포함본 사용 (라벨 불일치 방어)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAPI<Category[]>('categories-with-preview')
      .then((data) => {
        if (!cancelled) setCategories(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '카테고리를 불러올 수 없습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // 하위 카테고리 로드
  const loadSubcategories = useCallback(async (cat: { id: number; name: string }) => {
    setLoading(true);
    setError(null);
    try {
      const subs = await fetchAPI<Subcategory[]>('subcategories', { id: String(cat.id) });
      setSubcategories(subs);
      setBreadcrumb((prev) => [...prev, { id: cat.id, name: cat.name }]);
      setView('subcategories');
    } catch (err) {
      setError(err instanceof Error ? err.message : '하위 카테고리를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 키워드 로드 (카테고리 데이터)
  const loadKeywords = useCallback(async (cat: { id: number; name: string }) => {
    setLoading(true);
    setError(null);
    try {
      const kws = await fetchAPI<Keyword[]>('keywords', { id: String(cat.id) });
      setKeywords(kws);
      setBreadcrumb((prev) => [...prev, { id: cat.id, name: cat.name }]);
      setView('keywords');
    } catch (err) {
      setError(err instanceof Error ? err.message : '키워드를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 카테고리 클릭 핸들러
  const handleCategoryClick = useCallback(
    (cat: { id: number; name: string; is_leaf?: number }) => {
      if (cat.is_leaf === 1) {
        void loadKeywords(cat);
      } else {
        void loadSubcategories(cat);
      }
    },
    [loadKeywords, loadSubcategories],
  );

  // 뒤로가기
  const goBack = useCallback(() => {
    if (view === 'keywords') {
      setBreadcrumb((prev) => prev.slice(0, -1));
      setView('subcategories');
      setKeywords([]);
    } else if (view === 'subcategories') {
      const newBreadcrumb = breadcrumb.slice(0, -1);
      setBreadcrumb(newBreadcrumb);
      if (newBreadcrumb.length === 0) {
        setView('categories');
        setSubcategories([]);
      } else {
        // 이전 카테고리의 하위를 다시 로드
        const parentId = newBreadcrumb[newBreadcrumb.length - 1]?.id;
        if (parentId) {
          setLoading(true);
          fetchAPI<Subcategory[]>('subcategories', { id: String(parentId) })
            .then(setSubcategories)
            .catch(() => {
              setView('categories');
              setSubcategories([]);
              setBreadcrumb([]);
            })
            .finally(() => setLoading(false));
        }
      }
    }
  }, [view, breadcrumb]);

  // 처음으로
  const goHome = useCallback(() => {
    setBreadcrumb([]);
    setSubcategories([]);
    setKeywords([]);
    setView('categories');
    setError(null);
  }, []);

  // 담기 완료 표시
  const markAdded = useCallback((keyword: string) => {
    setAddedKeywords((prev) => new Set(prev).add(keyword));
  }, []);

  return (
    <section className="rounded-lg border border-navy-200 bg-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-navy-900">
            아이템 스카우트 카테고리 탐색
          </h2>
        </div>
        {view !== 'categories' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1 rounded-md border border-navy-200 px-2 py-1 text-xs font-semibold text-navy-600 hover:bg-navy-50"
            >
              <ArrowLeft className="h-3 w-3" />
              뒤로
            </button>
            <button
              type="button"
              onClick={goHome}
              className="rounded-md border border-navy-200 px-2 py-1 text-xs font-semibold text-navy-600 hover:bg-navy-50"
            >
              처음으로
            </button>
          </div>
        )}
      </div>

      {/* 브레드크럼 */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 border-b border-navy-50 px-4 py-2 text-xs text-navy-500">
          <button type="button" onClick={goHome} className="hover:text-teal-700">
            전체
          </button>
          {breadcrumb.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <span className="font-semibold text-navy-700">{item.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
            <span className="ml-2 text-sm text-navy-500">불러오는 중...</span>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
            {error}
          </div>
        )}

        {!loading && !error && view === 'categories' && (
          <CategoryGrid
            categories={categories}
            onSelect={(cat) =>
              handleCategoryClick({ id: cat.id, name: displayCategoryName(cat) })
            }
          />
        )}

        {!loading && !error && view === 'subcategories' && (
          <SubcategoryList
            subcategories={subcategories}
            onSelect={(sub) =>
              handleCategoryClick({
                id: sub.id,
                name: sub.name,
                is_leaf: sub.is_leaf,
              })
            }
            onLoadKeywords={(sub) => void loadKeywords({ id: sub.id, name: sub.name })}
          />
        )}

        {!loading && !error && view === 'keywords' && (
          <KeywordGrid
            keywords={keywords}
            addToBasketAction={addToBasketAction}
            addedKeywords={addedKeywords}
            onAdded={markAdded}
            userCompanies={userCompanies}
            activeCompanyId={activeCompanyId}
            selectedKeywords={selectedKeywords}
            onToggleSelect={toggleKeywordSelect}
            onBulkToggle={bulkToggleKeywords}
            onClearSelection={clearSelection}
          />
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 카테고리 대분류 그리드
// ─────────────────────────────────────────────────────────

function CategoryGrid({
  categories,
  onSelect,
}: {
  categories: Category[];
  onSelect: (cat: Category) => void;
}) {
  if (categories.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-navy-400">
        카테고리를 불러올 수 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* 안내 — 라벨과 실제 하위가 다를 수 있음 */}
      <p className="text-[11px] leading-relaxed text-navy-500">
        💡 ItemScout API 라벨이 실제 하위와 다른 경우가 있어 각 카드에
        <span className="mx-1 font-semibold text-navy-700">실제 하위 3개</span>
        를 함께 표시합니다. 미리보기를 보고 원하는 카테고리를 고르세요.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <CategoryCard key={cat.id} cat={cat} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

/** 카테고리 카드 — 보정된 이름을 크게, 원본 라벨은 작게 */
function CategoryCard({
  cat,
  onSelect,
}: {
  cat: Category;
  onSelect: (cat: Category) => void;
}) {
  const displayName = displayCategoryName(cat);
  const icon = CATEGORY_ICONS[displayName] ?? CATEGORY_ICONS[cat.n] ?? '📦';
  const isCorrected = displayName !== cat.n;

  return (
    <button
      type="button"
      onClick={() => onSelect(cat)}
      className="group flex items-start gap-3 rounded-lg border border-navy-100 bg-navy-50/30 p-3 text-left transition hover:border-teal-300 hover:bg-teal-50/30"
    >
      <span className="text-2xl leading-none">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-navy-800 group-hover:text-teal-700">
            {displayName}
          </span>
          {isCorrected && (
            <span
              className="rounded bg-amber-50 px-1 py-0.5 font-mono text-[9px] text-amber-700"
              title={`API 라벨: "${cat.n}" — 실제 내용이 달라 보정됨`}
            >
              보정
            </span>
          )}
        </div>
        {cat.previewError ? (
          <span className="text-[10px] italic text-amber-600">
            미리보기 로드 실패
          </span>
        ) : cat.preview && cat.preview.length > 0 ? (
          <span
            className="mt-0.5 block truncate text-[11px] text-navy-500"
            title={cat.preview.join(', ')}
          >
            {cat.preview.join(' · ')}
          </span>
        ) : (
          <span className="text-[10px] italic text-navy-400">
            (하위 정보 없음)
          </span>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// 하위 카테고리 목록
// ─────────────────────────────────────────────────────────

function SubcategoryList({
  subcategories,
  onSelect,
  onLoadKeywords,
}: {
  subcategories: Subcategory[];
  onSelect: (sub: Subcategory) => void;
  onLoadKeywords: (sub: Subcategory) => void;
}) {
  if (subcategories.length === 0) {
    return (
      <div className="py-8 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-navy-300" />
        <p className="mt-2 text-sm text-navy-400">하위 카테고리가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {subcategories.map((sub) => (
        <div
          key={sub.id}
          className="flex items-center justify-between rounded-md border border-navy-100 px-3 py-2 transition hover:border-teal-200 hover:bg-teal-50/20"
        >
          <button
            type="button"
            onClick={() => onSelect(sub)}
            className="flex flex-1 items-center gap-2 text-left text-sm text-navy-800 hover:text-teal-700"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-navy-400" />
            {sub.name}
            {sub.is_leaf === 0 && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-navy-300" />
                <span className="text-[10px] text-navy-400">하위 더 있음</span>
              </>
            )}
            {sub.is_leaf === 1 && (
              <span className="text-[10px] text-emerald-600">· leaf</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onLoadKeywords(sub)}
            className="shrink-0 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 hover:bg-teal-100"
            title="이 카테고리에서 바로 키워드 조회 (데이터 없으면 상위 카테고리 조회 추천)"
          >
            <TrendingUp className="mr-0.5 inline h-2.5 w-2.5" />
            키워드 보기
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 키워드 결과 그리드
// ─────────────────────────────────────────────────────────

// 검색량 범위 빠른 프리셋 (min, max) — 입력값 자동 채우기용
const SEARCH_VOLUME_RANGES: Array<{ label: string; min: number; max: number | null }> = [
  { label: '전체', min: 0, max: null },
  { label: '1~1만', min: 1, max: 10_000 },
  { label: '1만~5만', min: 10_000, max: 50_000 },
  { label: '5만~10만', min: 50_000, max: 100_000 },
  { label: '10만+', min: 100_000, max: null },
];

type SortKey =
  | 'rank'           // 기본 (아이템스카우트 랭크 오름차순)
  | 'searchDesc'     // 검색량 많은 순
  | 'searchAsc'      // 검색량 적은 순
  | 'productsAsc'    // 상품수 적은 순 (블루오션 기미)
  | 'productsDesc'   // 상품수 많은 순
  | 'ratioAsc';      // 상품수/검색량 비율 낮은 순 (적은 경쟁)

const SORT_LABELS: Record<SortKey, string> = {
  rank: '랭크 순 (기본)',
  searchDesc: '검색량 많은 순',
  searchAsc: '검색량 적은 순',
  productsAsc: '상품수 적은 순',
  productsDesc: '상품수 많은 순',
  ratioAsc: '상품수/검색량 낮은 순 (블루오션)',
};

/**
 * 빈 문자열·음수·NaN 을 null 로 정규화 (하한은 0, 상한은 무한대로 취급).
 */
function parseNumInput(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function KeywordGrid({
  keywords,
  addToBasketAction,
  addedKeywords,
  onAdded,
  userCompanies,
  activeCompanyId,
  selectedKeywords,
  onToggleSelect,
  onBulkToggle,
  onClearSelection,
}: {
  keywords: Keyword[];
  addToBasketAction: (form: FormData) => void;
  addedKeywords: Set<string>;
  onAdded: (keyword: string) => void;
  userCompanies: BrowserCompany[];
  activeCompanyId: string;
  selectedKeywords: Set<string>;
  onToggleSelect: (keyword: string) => void;
  onBulkToggle: (keywords: string[], shouldSelect: boolean) => void;
  onClearSelection: () => void;
}) {
  // 검색량 범위 (월간) — null = 경계 없음
  const [minSearch, setMinSearch] = useState<number | null>(null);
  const [maxSearch, setMaxSearch] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  // 쿠팡 조건 — 배치 분석 페이지로 같이 넘어갈 값 (prefill)
  const [coupangReviewThreshold, setCoupangReviewThreshold] = useState(500);
  const [coupangBelowRatio, setCoupangBelowRatio] = useState(60); // %
  // Shift+클릭 범위 선택용 — 마지막으로 토글한 filtered 배열 인덱스
  const lastClickedIndexRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const lo = minSearch ?? 0;
    const hi = maxSearch ?? Number.POSITIVE_INFINITY;
    const visible = keywords.filter((kw) => {
      const total = kw.monthly?.total ?? 0;
      return total >= lo && total <= hi;
    });
    const sorted = [...visible];
    sorted.sort((a, b) => {
      const sa = a.monthly?.total ?? 0;
      const sb = b.monthly?.total ?? 0;
      const pa = a.prdCnt ?? 0;
      const pb = b.prdCnt ?? 0;
      switch (sortKey) {
        case 'searchDesc':
          return sb - sa;
        case 'searchAsc':
          return sa - sb;
        case 'productsAsc':
          return pa - pb;
        case 'productsDesc':
          return pb - pa;
        case 'ratioAsc': {
          // 상품수/검색량 비율 — 검색량 0 인 항목은 맨 뒤로
          const ra = sa > 0 ? pa / sa : Number.POSITIVE_INFINITY;
          const rb = sb > 0 ? pb / sb : Number.POSITIVE_INFINITY;
          return ra - rb;
        }
        case 'rank':
        default:
          return a.rank - b.rank;
      }
    });
    return sorted;
  }, [keywords, minSearch, maxSearch, sortKey]);

  if (keywords.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50/50 p-5 text-center">
        <Search className="mx-auto h-8 w-8 text-amber-500" />
        <p className="mt-2 text-sm font-semibold text-amber-900">
          이 카테고리에는 아이템스카우트 데이터가 없습니다.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-amber-800">
          아이템스카우트는 일부 깊은 세부 카테고리나 특정 대분류(도서·문구·완구·음반·반려용품)
          데이터를 제공하지 않습니다.
          <br />
          <strong className="text-amber-900">위쪽 &quot;뒤로&quot; 버튼으로 상위 카테고리로 이동</strong>해서
          다시 시도하세요.
        </p>
      </div>
    );
  }

  const isFilterActive = minSearch !== null || maxSearch !== null;

  return (
    <div className="space-y-3">
      {/* 필터·정렬 바 */}
      <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50/30 p-3">
        {/* 1행: 검색량 범위 (min ~ max) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-700">
            <SlidersHorizontal className="h-3 w-3" />
            월간 검색량
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={minSearch ?? ''}
            onChange={(e) => setMinSearch(parseNumInput(e.target.value))}
            placeholder="최소"
            className="h-7 w-24 rounded-md border border-navy-200 bg-white px-2 text-[11px] text-navy-800 focus:border-teal-400 focus:outline-none"
            aria-label="검색량 최소"
          />
          <span className="text-[11px] font-semibold text-navy-500">~</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={maxSearch ?? ''}
            onChange={(e) => setMaxSearch(parseNumInput(e.target.value))}
            placeholder="최대"
            className="h-7 w-24 rounded-md border border-navy-200 bg-white px-2 text-[11px] text-navy-800 focus:border-teal-400 focus:outline-none"
            aria-label="검색량 최대"
          />
          {isFilterActive && (
            <button
              type="button"
              onClick={() => {
                setMinSearch(null);
                setMaxSearch(null);
              }}
              className="h-7 rounded-md border border-navy-200 bg-white px-2 text-[11px] font-semibold text-navy-500 hover:border-red-300 hover:text-red-600"
            >
              초기화
            </button>
          )}

          {/* 빠른 범위 프리셋 */}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {SEARCH_VOLUME_RANGES.map((p) => {
              const active =
                (minSearch ?? 0) === p.min
                && (maxSearch ?? null) === (p.max ?? null);
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setMinSearch(p.min === 0 ? null : p.min);
                    setMaxSearch(p.max);
                  }}
                  className={
                    active
                      ? 'rounded border border-teal-400 bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800'
                      : 'rounded border border-navy-200 bg-white px-1.5 py-0.5 text-[10px] text-navy-500 hover:border-teal-300 hover:text-teal-700'
                  }
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2행: 정렬 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-700">
            <ArrowDownUp className="h-3 w-3" />
            정렬
          </span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-7 rounded-md border border-navy-200 bg-white px-2 text-[11px] text-navy-800 focus:border-teal-400 focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[11px] text-navy-500">
            {filtered.length === keywords.length
              ? `${keywords.length}개 전체`
              : `${keywords.length}개 중 ${filtered.length}개 표시`}
          </span>
        </div>

        {/* 3행: 쿠팡 조건 + 원클릭 배치 분석 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-teal-200 pt-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-700">
            🛒 쿠팡 리뷰
          </span>
          <input
            type="number"
            min={0}
            step={50}
            value={coupangReviewThreshold}
            onChange={(e) => setCoupangReviewThreshold(Math.max(0, Number(e.target.value) || 0))}
            className="h-7 w-20 rounded-md border border-navy-200 bg-white px-2 text-[11px] text-navy-800 focus:border-teal-400 focus:outline-none"
            aria-label="쿠팡 리뷰 임계값"
          />
          <span className="text-[11px] text-navy-600">미만이</span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={coupangBelowRatio}
            onChange={(e) => setCoupangBelowRatio(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            className="h-7 w-14 rounded-md border border-navy-200 bg-white px-2 text-[11px] text-navy-800 focus:border-teal-400 focus:outline-none"
            aria-label="쿠팡 조건 비율"
          />
          <span className="text-[11px] text-navy-600">% 이상</span>

          <button
            type="button"
            onClick={() => {
              if (filtered.length === 0) return;
              const keywordList = filtered.map((k) => k.keyword);
              const encoded = keywordList.map(encodeURIComponent).join(',');
              const url = `/research/batch-analysis?keywords=${encoded}&review=${coupangReviewThreshold}&ratio=${coupangBelowRatio}&auto=1`;
              window.location.href = url;
            }}
            disabled={filtered.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="필터 통과한 전체 키워드를 쿠팡 배치 분석으로 바로 보내고 자동 시작"
          >
            ⚡ 필터 통과 {filtered.length}개 즉시 분석
          </button>
        </div>
      </div>

      {/* 결과 */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4 text-center text-sm text-amber-800">
          필터 조건에 맞는 키워드가 없습니다. 최소 검색량을 낮춰보세요.
        </div>
      ) : (
        <>
          <p className="text-xs text-navy-500">
            마음에 드는 상품을 장바구니에 담으세요.
            <span className="ml-1 text-navy-400">
              · 체크박스 <kbd className="rounded border border-navy-300 bg-white px-1 font-mono text-[10px]">Shift</kbd>+클릭으로 범위 선택 가능
            </span>
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((kw, index) => (
              <KeywordCard
                key={kw.keyword}
                keyword={kw}
                addToBasketAction={addToBasketAction}
                isAdded={addedKeywords.has(kw.keyword)}
                onAdded={onAdded}
                userCompanies={userCompanies}
                activeCompanyId={activeCompanyId}
                isSelected={selectedKeywords.has(kw.keyword)}
                onSelectClick={(shiftKey) => {
                  const last = lastClickedIndexRef.current;
                  if (shiftKey && last !== null && last !== index) {
                    const from = Math.min(last, index);
                    const to = Math.max(last, index);
                    const rangeKeywords = filtered.slice(from, to + 1).map((k) => k.keyword);
                    // 클릭한 카드의 현재 상태 반대로 범위 전체 적용
                    const shouldSelect = !selectedKeywords.has(kw.keyword);
                    onBulkToggle(rangeKeywords, shouldSelect);
                  } else {
                    onToggleSelect(kw.keyword);
                  }
                  lastClickedIndexRef.current = index;
                }}
              />
            ))}
          </div>

          {/* 플로팅 툴바 — 선택된 키워드가 있을 때만 표시 */}
          {selectedKeywords.size > 0 && (
            <SelectionToolbar
              selectedKeywords={selectedKeywords}
              onClear={onClearSelection}
            />
          )}
        </>
      )}
    </div>
  );
}

function KeywordCard({
  keyword: kw,
  addToBasketAction,
  isAdded,
  onAdded,
  userCompanies,
  activeCompanyId,
  isSelected,
  onSelectClick,
}: {
  keyword: Keyword;
  addToBasketAction: (form: FormData) => void;
  isAdded: boolean;
  onAdded: (keyword: string) => void;
  userCompanies: BrowserCompany[];
  activeCompanyId: string;
  isSelected: boolean;
  onSelectClick: (shiftKey: boolean) => void;
}) {
  const ratioNum = kw.coupangCompetitionRatio != null ? parseFloat(kw.coupangCompetitionRatio) : null;
  const competition = getCompetitionLevel(ratioNum);
  const avgPrice = kw.coupangAveragePrice;
  const avgReviews = kw.coupangAverageReviewCount;

  const monthlyTotal = kw.monthly?.total ?? 0;
  const productCount = kw.prdCnt ?? 0;

  const memoLines = [
    `월간검색량: ${monthlyTotal.toLocaleString('ko-KR')}`,
    `상품수: ${productCount.toLocaleString('ko-KR')}`,
    ratioNum != null ? `쿠팡 경쟁: ${competition.label} (${ratioNum.toFixed(0)}점)` : null,
    avgPrice ? `쿠팡 평균가: ₩${avgPrice.toLocaleString('ko-KR')}` : null,
    avgReviews ? `쿠팡 평균리뷰: ${avgReviews}개` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 transition ${
        isSelected
          ? 'border-blue-400 bg-blue-50/50'
          : 'border-navy-100 bg-navy-50/20'
      }`}
    >
      {/* 배치 선택 체크박스 — Shift+클릭으로 범위 선택 지원 */}
      <label
        className="flex shrink-0 cursor-pointer items-center pt-1"
        title="배치 분석에 포함 (Shift+클릭: 범위 선택)"
        onClick={(e) => {
          // 체크박스 기본 토글 막고 직접 처리 (shiftKey 보존)
          e.preventDefault();
          onSelectClick(e.shiftKey);
        }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {
            /* onClick 에서 처리 — onChange 는 React warning 방지용 noop */
          }}
          className="h-4 w-4 cursor-pointer rounded border-navy-300 text-blue-600 focus:ring-blue-500"
        />
      </label>
      {/* 이미지 */}
      {kw.image && (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={kw.image}
            alt={kw.keyword}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* 정보 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-navy-900">
            {kw.keyword}
          </span>
          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${competition.color}`}>
            {competition.label}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-navy-500">
          <span>
            <TrendingUp className="mr-0.5 inline h-2.5 w-2.5" />
            검색 {monthlyTotal.toLocaleString('ko-KR')}
          </span>
          <span>
            <ShoppingCart className="mr-0.5 inline h-2.5 w-2.5" />
            상품 {productCount.toLocaleString('ko-KR')}
          </span>
          {avgPrice != null && avgPrice > 0 && (
            <span>평균가 ₩{avgPrice.toLocaleString('ko-KR')}</span>
          )}
        </div>
      </div>

      {/* 담기 버튼 + 법인 선택 (멤버십 2개 이상일 때만 드롭다운) */}
      {isAdded ? (
        <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-700">
          ✓ 담김
        </span>
      ) : (
        <form
          action={(formData) => {
            addToBasketAction(formData);
            onAdded(kw.keyword);
          }}
          className="flex shrink-0 flex-col items-end gap-1"
        >
          <input type="hidden" name="name" value={kw.keyword} />
          <input type="hidden" name="memo" value={memoLines} />
          {/* 담기 후 → 쿠팡 1페이지 분석으로 자동 이동 */}
          <input
            type="hidden"
            name="redirectTo"
            value={`/research/coupang-first-page?keyword=${encodeURIComponent(kw.keyword)}`}
          />
          {userCompanies.length > 1 && (
            <select
              name="targetCompanyId"
              defaultValue={activeCompanyId}
              className="h-6 max-w-[110px] truncate rounded border border-navy-200 bg-white px-1 text-[10px] text-navy-700 focus:border-teal-400 focus:outline-none"
              title="담을 법인 선택"
              aria-label="담을 법인"
            >
              {userCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-md border border-teal-300 bg-teal-50 px-2 py-1.5 text-[10px] font-semibold text-teal-700 transition hover:bg-teal-100"
          >
            <Plus className="mr-0.5 inline h-3 w-3" />
            담기
          </button>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 플로팅 툴바 — 배치 선택된 키워드가 있을 때 하단에 뜸
// ─────────────────────────────────────────────────────────

function SelectionToolbar({
  selectedKeywords,
  onClear,
}: {
  selectedKeywords: Set<string>;
  onClear: () => void;
}) {
  const count = selectedKeywords.size;
  // 선택한 키워드들을 URL 쿼리로 전달
  const keywords = Array.from(selectedKeywords);
  const encoded = keywords.map((k) => encodeURIComponent(k)).join(',');
  const href = `/research/batch-analysis?keywords=${encoded}`;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-blue-300 bg-white shadow-lg">
      <div className="flex items-center gap-3 px-4 py-2">
        <span className="text-sm font-semibold text-blue-700">
          ✓ {count}개 선택됨
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-navy-500 hover:text-red-600"
        >
          해제
        </button>
        <a
          href={href}
          className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
        >
          일괄 분석 →
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

function getCompetitionLevel(ratio: number | undefined | null): {
  label: string;
  color: string;
} {
  if (ratio == null) return { label: '?', color: 'bg-navy-50 text-navy-400' };
  if (ratio < COMPETITION_THRESHOLD_LOW) return { label: COMPETITION_LABELS['low'] ?? '쉬움', color: 'bg-emerald-50 text-emerald-700' };
  if (ratio < COMPETITION_THRESHOLD_HIGH) return { label: COMPETITION_LABELS['medium'] ?? '보통', color: 'bg-amber-50 text-amber-700' };
  return { label: COMPETITION_LABELS['high'] ?? '어려움', color: 'bg-red-50 text-red-700' };
}
