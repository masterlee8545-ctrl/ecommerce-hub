/**
 * /research/batch-analysis?keywords=a,b,c — 배치 1페이지 분석
 *
 * 출처: 사용자 요구 — 여러 키워드를 한 번에 필터해 블루오션 후보 추출
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트), §1 P-9 (한국어)
 *
 * 흐름:
 * - ItemScoutBrowser 키워드 뷰에서 체크박스 → 플로팅 툴바 → 여기로
 * - 쿼리 파라미터 keywords=a,b,c (URL-encoded 쉼표 구분)
 * - 클라이언트에서 순차 스크래핑 + 실시간 결과 누적
 *
 * 보안: requireCompanyContext — 미인증 차단
 */
import { Suspense } from 'react';

import Link from 'next/link';

import { ArrowLeft, Zap } from 'lucide-react';

import { listCompaniesForUser } from '@/lib/auth/company';
import { requireCompanyContext } from '@/lib/auth/session';

import { BatchAnalysisForm } from './batch-form';

export const dynamic = 'force-dynamic';

export default async function BatchAnalysisPage() {
  const ctx = await requireCompanyContext();
  const companies = await listCompaniesForUser(ctx.userId);
  const active = companies.find((c) => c.id === ctx.companyId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/research"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          리서치로 돌아가기
        </Link>
        <h1 className="mt-3 flex items-center gap-3 text-3xl font-bold text-navy-900">
          <Zap className="h-8 w-8 text-blue-600" aria-hidden />
          배치 1페이지 분석
        </h1>
        <p className="mt-2 text-base leading-relaxed text-navy-600">
          여러 키워드를 한 번에 쿠팡 1페이지 메트릭으로 검증 →
          진입 장벽 낮은 블루오션만 자동 추출 →
          <span className="ml-1 font-semibold text-blue-700">{active?.name ?? '활성 법인'}</span>
          의 장바구니로 일괄 담기.
        </p>
      </header>

      {/* 사용 안내 */}
      <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-5">
        <div className="text-base font-bold text-navy-900">🎯 이 도구는 이럴 때</div>
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-navy-700">
          <li>아이템스카우트에서 검색량 좋은 키워드 10~20개 뽑았는데 어느 게 진입 가능한지 궁금할 때</li>
          <li>&quot;리뷰 300 미만이 과반수 이상인 상품&quot; 같은 조건으로 블루오션 자동 추출</li>
          <li>캐시(24시간) 활용으로 두 번째 조회부터는 빠름. 필요 시 강제 새로 스크래핑 가능</li>
        </ul>
      </section>

      {/* 실행 폼 */}
      <Suspense fallback={<div className="text-sm text-navy-500">로딩 중...</div>}>
        <BatchAnalysisForm
          targetCompanyId={ctx.companyId}
          userCompanies={companies.map((c) => ({ id: c.id, name: c.name }))}
        />
      </Suspense>
    </div>
  );
}
