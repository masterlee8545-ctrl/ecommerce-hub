/**
 * /research/coupang-reviews — 쿠팡 경쟁 상품 리뷰 분석기
 *
 * 출처: docs/SPEC.md §3 Research, C-3 Phase 1 MVP
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹), §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 사용자가 쿠팡 상품 페이지에서 복사한 리뷰 텍스트를 붙여넣음
 * - "분석하기" 클릭 → /api/research/coupang-reviews/analyze 호출
 * - 결과를 카드 형태로 렌더 (불만 / 장점 / 차별화 포인트)
 *
 * 구조:
 * - 서버 컴포넌트(이 파일): requireCompanyContext + 정적 안내 + 클라이언트 폼 마운트
 * - 클라이언트 컴포넌트(./review-analyzer-form.tsx): 폼 + fetch + 결과 렌더
 *
 * 보안:
 * - requireCompanyContext()가 미인증 자동 리디렉션 — 페이지 진입만 해도 인증 보장
 * - 분석 자체는 stateless라 RLS 불필요 (분석기는 DB 안 건드림)
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';

import { ReviewAnalyzerForm } from './review-analyzer-form';

export const dynamic = 'force-dynamic';

export default async function CoupangReviewsPage() {
  // 인증만 보장 — 결과는 회사별 저장 없음 (이번 단계는 임시 분석)
  await requireCompanyContext();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/research"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          리서치로 돌아가기
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">쿠팡 리뷰 분석기</h1>
        <p className="mt-1 text-sm text-navy-500">
          경쟁 상품의 쿠팡 리뷰 텍스트를 붙여넣으면 AI가 핵심 인사이트를 자동으로 정리합니다.
        </p>
      </header>

      {/* 사용 안내 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-navy-700">
        <div className="font-semibold text-navy-900">사용 방법</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-navy-600">
          <li>쿠팡 앱이나 웹에서 분석하고 싶은 상품 페이지를 연다</li>
          <li>리뷰 영역의 텍스트를 드래그해서 복사한다 (별점, 작성일 포함 가능)</li>
          <li>아래 입력창에 붙여넣고 분석하기 버튼을 누른다</li>
          <li>결과는 <span className="font-semibold text-yellow-700">🟡 추정값(estimated)</span> 이다 — 회계 계산에는 사용 금지</li>
        </ol>
      </section>

      {/* 클라이언트 폼 */}
      <ReviewAnalyzerForm />
    </div>
  );
}
