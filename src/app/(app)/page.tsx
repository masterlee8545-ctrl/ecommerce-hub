/**
 * 홈 대시보드 — "오늘 할 일" 중심의 워크플로우 화면
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 오늘 집중할 일을 한눈에 보여줌
 * - 5단계 파이프라인 현황 (컴팩트)
 * - 빠른 진입 (상품 발굴 시작, 수입 의뢰)
 */
import Link from 'next/link';

import {
  ArrowRight,
  ClipboardList,
  PackageSearch,
  Rocket,
  Search,
  ShoppingCart,
  Truck,
} from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { getDashboardStats, type PipelineStage } from '@/lib/dashboard/stats';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────
// 파이프라인 메타
// ─────────────────────────────────────────────────────────

const STAGE_META: Record<
  PipelineStage,
  {
    label: string;
    href: string;
    icon: typeof Search;
    color: string;
    bgColor: string;
  }
> = {
  research: {
    label: '상품 발굴',
    href: '/research',
    icon: Search,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  sourcing: {
    label: '수입 의뢰',
    href: '/sourcing',
    icon: ShoppingCart,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
  },
  importing: {
    label: '수입중',
    href: '/importing',
    icon: Truck,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  listing: {
    label: '등록',
    href: '/listing',
    icon: PackageSearch,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  active: {
    label: '런칭',
    href: '/active',
    icon: Rocket,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
  },
};

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function HomePage() {
  const ctx = await requireCompanyContext();
  const stats = await getDashboardStats(ctx.companyId);

  const firstName = ctx.name || ctx.email.split('@')[0];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 인사 + 오늘 할 일 */}
      <section>
        <h1 className="text-2xl font-bold text-navy-900">
          {firstName}님, 오늘 뭐 할까요?
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          파이프라인을 따라가며 한 단계씩 진행하세요.
        </p>
      </section>

      {/* 미해결 작업 요약 */}
      {stats.openTasks > 0 && (
        <Link
          href="/tasks"
          className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-4 transition hover:border-orange-300"
        >
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-orange-600" />
            <div>
              <span className="text-sm font-semibold text-orange-800">
                미해결 작업 {stats.openTasks}건
              </span>
              <span className="ml-2 text-xs text-orange-600">
                처리가 필요합니다
              </span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-orange-400" />
        </Link>
      )}

      {/* 5단계 파이프라인 — 세로 흐름 */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-navy-500">
          상품 파이프라인
        </h2>
        <div className="space-y-2">
          {stats.pipelineCounts.map((entry, idx) => {
            const meta = STAGE_META[entry.stage];
            const Icon = meta.icon;
            const isLast = idx === stats.pipelineCounts.length - 1;
            return (
              <Link
                key={entry.stage}
                href={meta.href}
                className="group flex items-center gap-4 rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
              >
                {/* 단계 번호 + 아이콘 */}
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.bgColor}`}
                  >
                    <Icon className={`h-4 w-4 ${meta.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-navy-400">
                        Step {idx + 1}
                      </span>
                      <span className="text-sm font-semibold text-navy-900">
                        {meta.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 상품 수 */}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-navy-800">
                    {entry.count}
                  </span>
                  <span className="text-xs text-navy-400">개</span>
                  <ArrowRight className="h-4 w-4 text-navy-300 transition group-hover:text-teal-500" />
                </div>

                {/* 진행선 (마지막 제외) */}
                {!isLast && (
                  <div className="absolute bottom-0 left-[2.35rem] h-2 w-px bg-navy-200" />
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {/* 요약 카드 */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-navy-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            전체 상품
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-teal-700">
            {stats.totalProducts}
            <span className="ml-1 text-sm font-normal text-navy-500">개</span>
          </div>
        </div>
        <Link
          href="/notifications"
          className="rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            알림
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-navy-800">
            {stats.unreadNotifications}
            <span className="ml-1 text-sm font-normal text-navy-500">건</span>
          </div>
        </Link>
      </section>

      {/* 빠른 시작 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
          빠른 시작
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Link
            href="/research/coupang-reviews"
            className="flex items-center gap-3 rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
              <Search className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-900">쿠팡 리뷰 분석</div>
              <div className="text-xs text-navy-500">경쟁 상품 리뷰에서 인사이트 추출</div>
            </div>
          </Link>
          <Link
            href="/sourcing/quotes/new"
            className="flex items-center gap-3 rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-50">
              <ShoppingCart className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-900">수입 의뢰</div>
              <div className="text-xs text-navy-500">새 견적 요청 + 원가 산정</div>
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
