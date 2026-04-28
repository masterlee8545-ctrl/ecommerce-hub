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

import { useEffect, useMemo, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, Loader2, ShoppingCart } from 'lucide-react';
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

export function SelloBrowser({
  targetCompanyId,
  userCompanies,
}: {
  targetCompanyId: string;
  userCompanies: Array<{ id: string; name: string }>;
}) {
  const [tree, setTree] = useState<TreeLevel[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // ['식품', '농산물', '과일', …]
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 필터
  const [minSearch, setMinSearch] = useState<number>(DEFAULT_MIN_SEARCH);
  const [maxSearch, setMaxSearch] = useState<number>(DEFAULT_MAX_SEARCH);
  const [maxCoupangReview, setMaxCoupangReview] = useState<number>(DEFAULT_MAX_COUPANG_REVIEW);
  const [excludeBrand, setExcludeBrand] = useState(true);

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
      setKeywords(body.keywords);
      setSelectedKeywords(new Set());
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

  // ── 리뷰 분포 분석 (사장님 핵심 use case) ──
  // 키워드 1개당 셀록홈즈 사용량 1회 차감.
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
        if (body.ok) next.set(keyword, body.distribution);
        else next.set(keyword, 'error');
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
  // 이미 분석된 건 스킵.
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

    setBulkAnalyzing(true);
    setBulkProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      const target = pending[i];
      if (!target) continue;
      // 순차 — sello rate-limit 방지
      // eslint-disable-next-line no-await-in-loop
      await analyzeOne(target.keyword);
      setBulkProgress({ done: i + 1, total: pending.length });
    }
    setBulkAnalyzing(false);
  }

  // ── 필터 적용 ──
  const filtered = useMemo(() => {
    if (!keywords) return [];
    return keywords.filter((k) => {
      if (k.monthlyQcCnt < minSearch) return false;
      if (k.monthlyQcCnt > maxSearch) return false;
      if (k.c_avgReviewCnt > maxCoupangReview) return false;
      if (excludeBrand && k.isBrandKey === 1) return false;
      return true;
    });
  }, [keywords, minSearch, maxSearch, maxCoupangReview, excludeBrand]);

  const breadcrumb = selected.length > 0 ? selected.join(' > ') : '최상위';

  return (
    <div className="space-y-4">
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
      {keywords !== null && (
        <section className="rounded-lg border border-navy-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-navy-900">
                📊 {breadcrumb} — <span className="text-violet-700">{keywords.length}개</span> 전체
                {filtered.length < keywords.length && (
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
                <button
                  type="button"
                  onClick={() => void analyzeAllFiltered(filtered)}
                  disabled={bulkAnalyzing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                  title={`필터 통과한 ${filtered.length}개 키워드의 실제 리뷰 분포 분석. 셀록홈즈 사용량 ${filtered.length}회 차감.`}
                >
                  {bulkAnalyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>🎯</span>
                  )}
                  필터 통과 {filtered.length}개 일괄 분석
                </button>
              </div>
            )}
          </div>

          {/* 필터 */}
          <div className="mb-3 grid grid-cols-1 gap-3 rounded-md bg-violet-50/40 p-3 text-xs md:grid-cols-4">
            <div>
              <label className="block font-semibold text-navy-700">월간 검색량 최소</label>
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
              <label className="block font-semibold text-navy-700">월간 검색량 최대</label>
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
              <label className="block font-semibold text-navy-700">쿠팡 평균 리뷰 최대</label>
              <input
                type="number"
                min={0}
                step={50}
                value={maxCoupangReview}
                onChange={(e) => setMaxCoupangReview(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 h-8 w-full rounded border border-navy-200 px-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludeBrand}
                  onChange={(e) => setExcludeBrand(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="font-semibold text-navy-700">브랜드 키워드 제외</span>
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
                    <th className="px-2 py-2 text-right">월검색</th>
                    <th className="px-2 py-2 text-right">경쟁</th>
                    <th className="px-2 py-2 text-right" title="평균 / 최대 — 차이가 크면 1~2개 큰 상품이 평균을 부풀린 상태 (실제 진입은 쉬울 수 있음)">
                      쿠팡 리뷰 <span className="text-[9px] font-normal text-navy-400">평균/최대</span>
                    </th>
                    <th className="px-2 py-2 text-center" title="실제 1페이지 상품 중 리뷰 500미만 개수 — 10개 이상이면 진입 가능 시장">
                      리뷰 분포 <span className="text-[9px] font-normal text-navy-400">&lt;500</span>
                    </th>
                    <th className="px-2 py-2 text-right">쿠팡 로켓%</th>
                    <th className="px-2 py-2 text-right">쿠팡 상품수</th>
                    <th className="px-2 py-2 text-right">평균가</th>
                    <th className="px-2 py-2 text-left">계절성</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((k) => {
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
                            onChange={() => {
                              setSelectedKeywords((prev) => {
                                const next = new Set(prev);
                                if (next.has(k.keyword)) next.delete(k.keyword);
                                else next.add(k.keyword);
                                return next;
                              });
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
