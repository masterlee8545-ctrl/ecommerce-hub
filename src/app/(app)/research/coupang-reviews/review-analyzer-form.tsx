/**
 * 쿠팡 리뷰 분석기 — 클라이언트 폼 컴포넌트
 *
 * 출처: /research/coupang-reviews 페이지의 인터랙티브 영역
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-3 (estimated 마킹), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - textarea 입력 + 상품 힌트 입력
 * - "분석하기" 버튼 클릭 시 /api/research/coupang-reviews/analyze 호출
 * - 로딩 / 에러 / 성공 상태 UI
 * - 결과 카드 렌더 (불만 / 장점 / 차별화 포인트)
 *
 * 디자인:
 * - 좌측 입력, 우측 결과 (md 이상) / 상단 입력, 하단 결과 (모바일)
 * - 결과 카드는 색상으로 의미 구분: 불만(빨강), 장점(녹색), 차별화(보라)
 */
'use client';

import { useState, useTransition } from 'react';

import { AlertCircle, Frown, Lightbulb, Loader2, Smile, Sparkles } from 'lucide-react';

import type { AnalyzeResult } from '@/lib/research/coupang-review-analyzer';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────
// 상수 (no-magic-numbers 회피)
// ─────────────────────────────────────────────────────────

const TEXTAREA_ROWS = 12;
const SUMMARY_FIRST_PARA_LIMIT = 60;
const KEY_SLICE_LEN = 16;

const FREQUENCY_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: '자주',
  medium: '가끔',
  low: '드물게',
};

const FREQUENCY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-navy-100 text-navy-600',
};

// ─────────────────────────────────────────────────────────
// API 응답 타입
// ─────────────────────────────────────────────────────────

interface AnalyzeApiSuccess {
  ok: true;
  result: AnalyzeResult;
  /** D-1: DB 저장 성공 시 분석 행 ID, 실패 시 null */
  savedId: string | null;
  /** D-1: 저장 실패 시 사용자 메시지 */
  saveWarning: string | null;
}

interface AnalyzeApiFailure {
  ok: false;
  error: string;
  details?: Array<{ path: string; message: string }>;
  stage?: string;
}

type AnalyzeApiResponse = AnalyzeApiSuccess | AnalyzeApiFailure;

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function ReviewAnalyzerForm() {
  const [rawText, setRawText] = useState('');
  const [productHint, setProductHint] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setResult(null);
    setSavedId(null);
    setSaveWarning(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/research/coupang-reviews/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText: rawText.trim(),
            productHint: productHint.trim() || undefined,
          }),
        });
        const data = (await res.json()) as AnalyzeApiResponse;

        if (!data.ok) {
          setError(data.error);
          return;
        }
        setResult(data.result);
        setSavedId(data.savedId);
        setSaveWarning(data.saveWarning);
      } catch (err) {
        setError(
          err instanceof Error
            ? `네트워크 오류: ${err.message}`
            : '알 수 없는 오류가 발생했습니다.',
        );
      }
    });
  }

  function handleClear() {
    if (isPending) return;
    setRawText('');
    setProductHint('');
    setResult(null);
    setSavedId(null);
    setSaveWarning(null);
    setError(null);
  }

  const charCount = rawText.length;
  const canSubmit = !isPending && charCount >= SUMMARY_FIRST_PARA_LIMIT / 2;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* ─── 입력 영역 ─── */}
      <form onSubmit={handleSubmit} className="space-y-4 lg:col-span-2">
        <div className="space-y-1">
          <label
            htmlFor="productHint"
            className="block text-xs font-semibold uppercase tracking-wide text-navy-500"
          >
            상품 힌트 (선택)
          </label>
          <input
            id="productHint"
            type="text"
            value={productHint}
            onChange={(e) => setProductHint(e.target.value)}
            placeholder="예: 실리콘 주방 용품"
            disabled={isPending}
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-navy-300 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-navy-50"
          />
          <p className="text-[11px] text-navy-400">
            카테고리나 상품 유형을 적으면 분석 정확도가 올라갑니다.
          </p>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="rawText"
            className="block text-xs font-semibold uppercase tracking-wide text-navy-500"
          >
            쿠팡 리뷰 텍스트 *
          </label>
          <textarea
            id="rawText"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="쿠팡 상품 페이지에서 복사한 리뷰 텍스트를 여기에 붙여넣으세요..."
            disabled={isPending}
            rows={TEXTAREA_ROWS}
            className="w-full resize-y rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-navy-300 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-navy-50"
            required
          />
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-navy-400">
              최소 30자 / 최대 8000자
            </span>
            <span
              className={cn(
                'tabular-nums',
                charCount > 0 ? 'text-navy-700' : 'text-navy-400',
              )}
            >
              {charCount.toLocaleString('ko-KR')}자
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700',
              !canSubmit && 'cursor-not-allowed bg-navy-300 hover:bg-navy-300',
            )}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                분석 중...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                분석하기
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="rounded-md border border-navy-200 bg-white px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-60"
          >
            초기화
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <div>{error}</div>
          </div>
        )}
      </form>

      {/* ─── 결과 영역 ─── */}
      <div className="lg:col-span-3">
        {result ? (
          <ResultPanel result={result} savedId={savedId} saveWarning={saveWarning} />
        ) : (
          <EmptyResultPanel isPending={isPending} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 패널 (성공)
// ─────────────────────────────────────────────────────────

function ResultPanel({
  result,
  savedId,
  saveWarning,
}: {
  result: AnalyzeResult;
  savedId: string | null;
  saveWarning: string | null;
}) {
  return (
    <div className="space-y-4">
      {/* 저장 상태 알림 (D-1) */}
      {savedId && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>✓ 분석 결과가 저장됐습니다.</span>
          <a
            href="/research/coupang-reviews/history"
            className="font-semibold text-emerald-700 underline hover:text-emerald-900"
          >
            히스토리 보기 →
          </a>
        </div>
      )}
      {saveWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ {saveWarning}
        </div>
      )}

      {/* 종합 평가 */}
      <section className="rounded-lg border border-navy-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            종합 평가
          </div>
          <span className="rounded bg-yellow-50 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">
            🟡 추정값
          </span>
        </div>
        <p className="mt-2 text-sm text-navy-800">{result.overallSummary}</p>
        {result.estimatedReviewCount > 0 && (
          <p className="mt-2 text-[11px] text-navy-400">
            분석된 리뷰: 약 {result.estimatedReviewCount}개 (추정)
          </p>
        )}
      </section>

      {/* 불만 */}
      <InsightSection
        title="자주 나오는 불만"
        items={result.topComplaints}
        Icon={Frown}
        accentColor="text-rose-700"
        accentBg="bg-rose-50"
        emptyText="불만으로 분류된 항목이 없습니다."
      />

      {/* 장점 */}
      <InsightSection
        title="자주 나오는 장점"
        items={result.topCompliments}
        Icon={Smile}
        accentColor="text-emerald-700"
        accentBg="bg-emerald-50"
        emptyText="장점으로 분류된 항목이 없습니다."
      />

      {/* 차별화 포인트 */}
      <section className="rounded-lg border border-navy-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-50 text-purple-700">
            <Lightbulb className="h-4 w-4" aria-hidden />
          </div>
          <h3 className="text-sm font-semibold text-navy-900">우리 상품의 차별화 포인트</h3>
        </div>
        {result.suggestedDifferentiators.length === 0 ? (
          <p className="mt-3 text-xs text-navy-400">
            제안된 차별화 포인트가 없습니다. 리뷰가 너무 짧거나 모호할 수 있습니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {result.suggestedDifferentiators.map((item, idx) => (
              <li
                key={`diff-${idx}-${item.slice(0, KEY_SLICE_LEN)}`}
                className="flex items-start gap-2 rounded-md bg-purple-50/50 px-3 py-2 text-sm text-navy-800"
              >
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[11px] font-bold text-purple-700">
                  {idx + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 인사이트 섹션 공용 (불만 / 장점)
// ─────────────────────────────────────────────────────────

interface InsightSectionProps {
  title: string;
  items: AnalyzeResult['topComplaints'];
  Icon: typeof Frown;
  accentColor: string;
  accentBg: string;
  emptyText: string;
}

function InsightSection({
  title,
  items,
  Icon,
  accentColor,
  accentBg,
  emptyText,
}: InsightSectionProps) {
  return (
    <section className="rounded-lg border border-navy-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', accentBg, accentColor)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-navy-400">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, idx) => (
            <li
              key={`item-${idx}-${item.text.slice(0, KEY_SLICE_LEN)}`}
              className="rounded-md border border-navy-100 bg-navy-50/30 px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    FREQUENCY_COLOR[item.frequencyHint],
                  )}
                >
                  {FREQUENCY_LABEL[item.frequencyHint]}
                </span>
                <p className="text-sm text-navy-800">{item.text}</p>
              </div>
              {item.quote && (
                <blockquote className="mt-1.5 border-l-2 border-navy-200 pl-2 text-[11px] italic text-navy-500">
                  &ldquo;{item.quote}&rdquo;
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 상태 패널
// ─────────────────────────────────────────────────────────

function EmptyResultPanel({ isPending }: { isPending: boolean }) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      {isPending ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-navy-700">AI가 리뷰를 분석하고 있어요...</p>
          <p className="mt-1 text-xs text-navy-500">보통 10~30초 정도 걸립니다.</p>
        </>
      ) : (
        <>
          <Sparkles className="h-8 w-8 text-navy-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-navy-700">분석 결과가 여기에 표시됩니다</p>
          <p className="mt-1 text-xs text-navy-500">
            왼쪽에 리뷰 텍스트를 붙여넣고 &ldquo;분석하기&rdquo;를 눌러보세요.
          </p>
        </>
      )}
    </div>
  );
}
