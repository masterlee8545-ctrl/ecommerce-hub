/**
 * /research — 상품 발굴 (아이템스카우트 카테고리 + 장바구니 + 검증 도구)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 아이템 스카우트 카테고리에서 상품을 탐색하고 장바구니에 담기
 * - 수동 추가 폼 (이름/URL/메모)
 * - 장바구니 목록 확인 + 검증 후 "수입 의뢰"로 넘기기
 * - 쿠팡 리뷰 분석 등 검증 도구 바로가기
 */
import Link from 'next/link';

import {
  BarChart3,
  FileSearch,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';

import { listCompaniesForUser, type CompanyWithRole } from '@/lib/auth/company';
import { requireCompanyContext } from '@/lib/auth/session';
import { quickAddToBasketAction } from '@/lib/products/actions';
import { listProducts } from '@/lib/products/queries';

import { BasketList } from './basket-list';
import { ResearchSideWidgets } from './research-side-widgets';
import { SelloBrowser } from './sello/sello-browser';

export const dynamic = 'force-dynamic';

const BASKET_LIMIT = 50;

// 법인 배지 색상 (CompanySwitcher 와 톤 맞춤, 라벨은 회사명 그대로)
const BUSINESS_TYPE_COLOR: Record<CompanyWithRole['businessType'], string> = {
  industrial: 'bg-blue-50 text-blue-700 border-blue-200',
  agricultural: 'bg-green-50 text-green-700 border-green-200',
  other: 'bg-navy-50 text-navy-700 border-navy-200',
};

export default async function ResearchPage() {
  const ctx = await requireCompanyContext();

  // 사용자가 속한 법인 목록 — "어느 법인에 담을지" 드롭다운용
  const userCompanies = await listCompaniesForUser(ctx.userId);
  const activeCompany = userCompanies.find((c) => c.id === ctx.companyId);

  // research 단계 상품 = 장바구니 (현재 활성 법인만 — RLS)
  let basketItems: Awaited<ReturnType<typeof listProducts>> = [];
  let dbError: string | null = null;
  try {
    basketItems = await listProducts({
      companyId: ctx.companyId,
      stages: ['research'],
      limit: BASKET_LIMIT,
    });
  } catch (err) {
    console.error('[research] 장바구니 조회 실패:', err);
    dbError =
      err instanceof Error ? err.message : '장바구니를 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto flex max-w-screen-2xl gap-6">
      {/* 메인 콘텐츠 */}
      <div className="min-w-0 flex-1 space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-blue-600">
          <Search className="h-5 w-5" aria-hidden />
          Step 1
        </div>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">상품 발굴</h1>
        <p className="mt-2 text-base text-navy-500">
          아이템 스카우트, 쿠팡, 1688 등에서 찾은 상품을 장바구니에 담아두세요.
          검증이 끝나면 수입 의뢰로 넘깁니다.
        </p>
      </header>

      {/* 빠른 추가 폼 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-navy-900">
          <Plus className="h-5 w-5 text-blue-600" />
          장바구니에 추가
        </h2>
        <form action={quickAddToBasketAction} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-navy-700">
                상품명 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                placeholder="예: 실리콘 마늘 다지기"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label htmlFor="sourceUrl" className="block text-xs font-semibold text-navy-700">
                소스 URL (선택)
              </label>
              <input
                type="url"
                id="sourceUrl"
                name="sourceUrl"
                placeholder="쿠팡/1688/아이템스카우트 링크"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="cnSourceUrl" className="block text-xs font-semibold text-navy-700">
              1688 / 타오바오 링크 (선택 — 수입업체 인계용)
            </label>
            <input
              type="url"
              id="cnSourceUrl"
              name="cnSourceUrl"
              placeholder="https://detail.1688.com/offer/... 또는 타오바오/알리바바 URL"
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div>
            <label htmlFor="memo" className="block text-xs font-semibold text-navy-700">
              메모 (선택)
            </label>
            <input
              type="text"
              id="memo"
              name="memo"
              placeholder="검색량, 경쟁강도, 특이사항 등 한줄 메모"
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          {/* 담을 법인 선택 — 멤버십이 2개 이상일 때만 드롭다운 표시 */}
          {userCompanies.length > 1 && (
            <div>
              <label htmlFor="targetCompanyId" className="block text-xs font-semibold text-navy-700">
                담을 법인
              </label>
              <select
                id="targetCompanyId"
                name="targetCompanyId"
                defaultValue={ctx.companyId}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                {userCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.id === ctx.companyId ? ' (현재)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-navy-500">
                기본값: 현재 활성 법인. 다른 법인 선택 시 그 법인에 담깁니다.
              </p>
            </div>
          )}
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <ShoppingCart className="h-4 w-4" />
            장바구니에 담기
          </button>
        </form>
      </section>

      {/* 🌊 시즌 펄스 — 작년 검색 데이터로 자동 시즌상품 추천 */}
      <section>
        <Link
          href="/research/season-pulse"
          className="group block rounded-xl border-2 border-dashed border-violet-300 bg-gradient-to-r from-violet-50 via-amber-50 to-emerald-50 p-6 transition hover:border-violet-500 hover:shadow-md"
        >
          <div className="flex items-start gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-3xl">
              🌊
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-navy-900">
                  시즌 펄스
                </h2>
                <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
                  AUTO
                </span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  NEW
                </span>
              </div>
              <p className="mt-2 text-base text-navy-600">
                작년 검색 데이터를 자동 분석해서{' '}
                <strong className="text-violet-700">
                  지금 소싱해야 할 시즌 키워드
                </strong>
                를 그룹별로 추천합니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded bg-white/70 px-2.5 py-1 text-amber-700">
                  🚨 지금 소싱
                </span>
                <span className="rounded bg-white/70 px-2.5 py-1 text-emerald-700">
                  📅 이번달 급상승
                </span>
                <span className="rounded bg-white/70 px-2.5 py-1 text-rose-700">
                  ⏳ 다음달 피크
                </span>
                <span className="rounded bg-white/70 px-2.5 py-1 text-violet-700">
                  📈 진행 중
                </span>
              </div>
            </div>
            <div className="self-center text-3xl text-violet-400 transition group-hover:translate-x-1 group-hover:text-violet-600">
              →
            </div>
          </div>
        </Link>
      </section>

      {/* 🆕 셀록홈즈 카테고리 소싱 — 네이버 검색량 + 쿠팡 리뷰 + 경쟁률 통합 */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-violet-600" />
          <h2 className="text-xl font-bold text-navy-900">
            셀록홈즈 카테고리 소싱
          </h2>
          <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
            BETA
          </span>
        </div>
        <SelloBrowser
          targetCompanyId={ctx.companyId}
          userCompanies={userCompanies.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>

      {/* 장바구니 목록 */}
      <section data-basket-anchor>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold uppercase tracking-wide text-navy-500">
              장바구니 ({basketItems.length}개)
            </h2>
            {activeCompany && (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  BUSINESS_TYPE_COLOR[activeCompany.businessType]
                }`}
                title={`현재 법인: ${activeCompany.name}`}
              >
                {activeCompany.name}
              </span>
            )}
          </div>
          {basketItems.length > 0 && (
            <Link
              href="/products?stage=research"
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              상세 목록 →
            </Link>
          )}
        </div>
        {userCompanies.length > 1 && (
          <p className="mb-2 text-[11px] text-navy-400">
            💡 장바구니는 현재 법인 기준입니다. 다른 법인 장바구니는 상단 헤더 법인 전환으로 확인하세요.
          </p>
        )}

        {dbError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
            <div className="font-semibold">장바구니를 불러올 수 없습니다</div>
            <p className="mt-1 text-xs">{dbError}</p>
          </div>
        ) : (
          <BasketList
            items={basketItems.map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
              description: i.description,
              created_at: i.created_at,
            }))}
          />
        )}
      </section>

      {/* 검증 도구 */}
      <section>
        <h2 className="mb-4 text-base font-semibold uppercase tracking-wide text-navy-500">
          검증 도구
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            href="/research/coupang-first-page"
            className="flex items-center gap-4 rounded-lg border border-navy-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-sm"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50">
              <BarChart3 className="h-6 w-6 text-blue-700" />
            </div>
            <div>
              <div className="text-base font-semibold text-navy-900">1페이지 메트릭</div>
              <div className="text-sm text-navy-500">
                상위 20개 리뷰수·로켓비율 조회
              </div>
            </div>
          </Link>
          <Link
            href="/research/coupang-reviews"
            className="flex items-center gap-4 rounded-lg border border-navy-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-sm"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-teal-50">
              <FileSearch className="h-6 w-6 text-teal-700" />
            </div>
            <div>
              <div className="text-base font-semibold text-navy-900">쿠팡 리뷰 분석</div>
              <div className="text-sm text-navy-500">
                리뷰 텍스트 AI 감성 분석
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-4 rounded-lg border border-dashed border-navy-200 bg-navy-50/20 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-navy-100">
              <Sparkles className="h-6 w-6 text-navy-400" />
            </div>
            <div>
              <div className="text-base font-semibold text-navy-500">디자인 특허 확인</div>
              <div className="text-sm text-navy-400">
                키프리스 조회 (준비중)
              </div>
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* 우측 사이드 위젯 영역 (sticky) */}
      <aside className="sticky top-6 hidden h-fit w-80 shrink-0 space-y-4 self-start xl:block">
        <ResearchSideWidgets />
      </aside>
    </div>
  );
}

