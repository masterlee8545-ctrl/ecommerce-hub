/**
 * /research/coupang-first-page — 쿠팡 1페이지 리뷰 메트릭 조회기
 *
 * 출처: src/lib/sello-scraper/metrics.ts (getCoupangFirstPageMetrics)
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹 — scraped, 회계 금지),
 *       §1 P-4 (멀티테넌트 RLS — 페이지 인증),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 키워드 입력 → 셀록홈즈 스크래퍼 캐시에서 쿠팡 1페이지 20개 상품의
 *   리뷰수·로켓비율·랭킹을 표로 렌더
 * - HUB 캐시 우선, BUYWISE 캐시 fallback
 *
 * 보안:
 * - requireCompanyContext()로 인증 보장 — 미인증 시 자동 /login
 * - 조회 전용(DB 안 건드림)이라 회사 격리 불필요하지만 페이지 접근 자체에 인증 강제
 */
import { Suspense } from 'react';

import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';

import { FirstPageForm } from './first-page-form';

export const dynamic = 'force-dynamic';

export default async function CoupangFirstPagePage() {
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
        <h1 className="mt-2 text-2xl font-bold text-navy-900">쿠팡 1페이지 메트릭</h1>
        <p className="mt-1 text-sm text-navy-500">
          키워드를 입력하면 쿠팡 검색결과 1페이지 상위 20개 상품의
          리뷰수·로켓비율·랭킹을 한눈에 확인할 수 있습니다.
        </p>
      </header>

      {/* 사용 안내 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-navy-700">
        <div className="font-semibold text-navy-900">읽는 법</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-navy-600">
          <li>
            <span className="font-semibold">로켓 비율</span> — 50% 이상이면 브랜드 과포화 시장.
            자체 브랜드 진입이 어렵습니다.
          </li>
          <li>
            <span className="font-semibold">리뷰 중앙값</span> — 1페이지 진입에 필요한
            리뷰 수의 감각적 기준. 중앙값보다 리뷰가 적은 상품이 있다면 진입 여지가 있다는 신호.
          </li>
          <li>
            데이터 출처는 셀록홈즈 로컬 캐시입니다. 새 키워드는 터미널에서
            <code className="mx-1 rounded bg-navy-100 px-1 py-0.5 font-mono text-[11px]">
              npm run sello:scrape -- &lt;키워드&gt;
            </code>
            로 먼저 스크래핑하세요.
          </li>
          <li>
            모든 수치는 <span className="font-semibold text-yellow-700">🟡 추정값(estimated)</span> —
            회계/세무 계산에는 사용 금지입니다.
          </li>
        </ul>
      </section>

      {/* 클라이언트 폼 — useSearchParams 가 있어서 Suspense 경계 필요 (Next 15) */}
      <Suspense fallback={<div className="text-sm text-navy-500">폼 로딩 중...</div>}>
        <FirstPageForm />
      </Suspense>
    </div>
  );
}
