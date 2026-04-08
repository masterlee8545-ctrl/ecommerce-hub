/**
 * /research/coupang-reviews/history — 분석 히스토리
 *
 * 출처: D-1 (저장 + 히스토리), src/lib/research/storage.ts
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-3 (estimated 마킹), §1 P-4 (멀티테넌트)
 *
 * 역할:
 * - 사장님이 과거에 한 쿠팡 리뷰 분석을 시간순(최신부터)으로 보여줌
 * - 각 행: 시간, 상품 힌트, 원문 길이, 종합 요약, 불만 개수, 장점 개수
 * - "다시 보기" 클릭 시 → /research/coupang-reviews/history/[id] (상세 — 다음 단계 D-1e+)
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 인증 + 회사 컨텍스트
 * 2. listRecentAnalyses({ companyId, limit: 50 }) — RLS 자동 적용
 * 3. 빈 목록이면 안내 카드, 있으면 행 리스트 렌더
 *
 * 보안 (P-4):
 * - withCompanyContext 안에서 쿼리되므로 다른 회사 데이터 0% 노출
 */
import Link from 'next/link';

import { ArrowLeft, FileSearch, Frown, Smile, Sparkles } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import type { AnalyzeResult } from '@/lib/research/coupang-review-analyzer';
import { listRecentAnalyses } from '@/lib/research/storage';

export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 50;

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function CoupangReviewsHistoryPage() {
  const ctx = await requireCompanyContext();

  // DB 조회 — 빈 목록이거나 DB 미준비 시 빈 배열로 폴백
  let rows: Awaited<ReturnType<typeof listRecentAnalyses>> = [];
  let dbError: string | null = null;
  try {
    rows = await listRecentAnalyses({ companyId: ctx.companyId, limit: HISTORY_LIMIT });
  } catch (err) {
    console.error('[history] listRecentAnalyses 실패:', err);
    dbError =
      err instanceof Error
        ? `히스토리 조회 중 오류: ${err.message}`
        : '히스토리를 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/research/coupang-reviews"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          분석기로 돌아가기
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">분석 히스토리</h1>
            <p className="mt-1 text-sm text-navy-500">
              지금까지 한 쿠팡 리뷰 분석을 시간순(최신부터)으로 봅니다. 최대 {HISTORY_LIMIT}개.
            </p>
          </div>
          <span className="rounded bg-yellow-50 px-2 py-1 text-[10px] font-semibold text-yellow-700">
            🟡 모든 결과는 추정값
          </span>
        </div>
      </header>

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 행
// ─────────────────────────────────────────────────────────

interface HistoryRowProps {
  row: Awaited<ReturnType<typeof listRecentAnalyses>>[number];
}

function HistoryRow({ row }: HistoryRowProps) {
  // jsonb는 unknown으로 들어오므로 안전하게 접근
  const result = row.result as AnalyzeResult;
  const complaintCount = Array.isArray(result.topComplaints) ? result.topComplaints.length : 0;
  const complimentCount = Array.isArray(result.topCompliments) ? result.topCompliments.length : 0;
  const summary = typeof result.overallSummary === 'string' ? result.overallSummary : '';

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* 상단: 시간 + 힌트 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
            <span>{formatDateTime(row.created_at)}</span>
            {row.product_hint && (
              <>
                <span className="text-navy-300">·</span>
                <span className="rounded bg-navy-100 px-1.5 py-0.5 font-semibold text-navy-700">
                  {row.product_hint}
                </span>
              </>
            )}
            <span className="text-navy-300">·</span>
            <span>원문 {row.raw_text_length.toLocaleString('ko-KR')}자</span>
            <span className="text-navy-300">·</span>
            <span className="font-mono text-navy-400">{row.model}</span>
          </div>

          {/* 종합 요약 */}
          <p className="mt-2 line-clamp-2 text-sm text-navy-800">
            {summary || '(요약 없음)'}
          </p>

          {/* 카운트 배지 */}
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-rose-700">
              <Frown className="h-3 w-3" aria-hidden />
              불만 {complaintCount}개
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Smile className="h-3 w-3" aria-hidden />
              장점 {complimentCount}개
            </span>
            {Array.isArray(result.suggestedDifferentiators) && (
              <span className="inline-flex items-center gap-1 text-purple-700">
                <Sparkles className="h-3 w-3" aria-hidden />
                차별화 {result.suggestedDifferentiators.length}개
              </span>
            )}
          </div>
        </div>

        {/* 우측: 미리보기 (앞 100자) */}
        <div className="hidden min-w-0 max-w-[200px] shrink-0 lg:block">
          <p className="line-clamp-3 rounded bg-navy-50/50 p-2 text-[11px] italic text-navy-500">
            &ldquo;{row.raw_text_excerpt.slice(0, 100)}...&rdquo;
          </p>
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <FileSearch className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">아직 저장된 분석이 없습니다</h2>
      <p className="mt-1 text-xs text-navy-500">
        분석기에서 첫 번째 리뷰를 분석하면 여기에 자동으로 쌓입니다.
      </p>
      <Link
        href="/research/coupang-reviews"
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        첫 분석 시작하기
      </Link>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">히스토리를 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결 또는 마이그레이션 적용을 확인하세요. (`npm run db:push` 또는{' '}
        `psql -f drizzle/migrations/0002_research_review_analyses.sql`)
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  try {
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(date);
  }
}
