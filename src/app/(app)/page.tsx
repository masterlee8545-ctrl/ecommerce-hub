/**
 * 홈 대시보드 — 인증된 사용자의 첫 화면
 *
 * 출처: docs/SPEC.md (홈 대시보드 KPI), C 단계 Phase 1 MVP
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹), §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 6단계 파이프라인의 단계별 상품 수
 * - 미해결 작업 / 미읽은 알림 카운트
 * - 빠른 진입 카드 (리서치 시작, 공급사 추가 등)
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 미인증 시 /login 자동 리디렉션
 * 2. getDashboardStats() — 회사 컨텍스트 안에서 RLS 보호 쿼리
 * 3. 서버 컴포넌트로 렌더 (force-dynamic — 매 요청마다 최신)
 *
 * 보안 보장:
 * - withCompanyContext() 자동 적용 → 다른 회사 데이터 0% 노출 (P-4)
 */
import Link from 'next/link';

import { requireCompanyContext } from '@/lib/auth/session';
import { getDashboardStats, type PipelineStage } from '@/lib/dashboard/stats';

// 매 요청마다 새로 측정 (캐시 금지)
export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────
// 단계별 메타데이터
// ─────────────────────────────────────────────────────────

const STAGE_META: Record<
  PipelineStage,
  {
    label: string;
    href: string;
    color: string;
    bgColor: string;
    description: string;
  }
> = {
  research: {
    label: '리서치',
    href: '/research',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    description: '쿠팡 리뷰 분석 + 트렌드',
  },
  sourcing: {
    label: '소싱',
    href: '/sourcing',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
    description: '공급사 + 견적 대기',
  },
  importing: {
    label: '수입',
    href: '/importing',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    description: '발주 + 통관 진행',
  },
  listing: {
    label: '등록',
    href: '/listing',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    description: '쿠팡/네이버 등록 작업',
  },
  active: {
    label: '판매',
    href: '/active',
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    description: '재고 + 판매 분석',
  },
  branding: {
    label: '브랜딩',
    href: '/branding',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
    description: 'SEO + 광고 + 리뷰',
  },
};

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function HomePage() {
  const ctx = await requireCompanyContext();
  const stats = await getDashboardStats(ctx.companyId);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* 인사 */}
      <section>
        <h1 className="text-2xl font-bold text-navy-900">
          안녕하세요, {ctx.name || ctx.email.split('@')[0]}님
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          오늘도 BUYWISE 파이프라인에 오신 것을 환영합니다.
        </p>
      </section>

      {/* KPI 카드 3종 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="전체 상품"
          value={stats.totalProducts}
          unit="개"
          accent="text-teal-700"
        />
        <KpiCard
          label="미해결 작업"
          value={stats.openTasks}
          unit="건"
          accent="text-orange-700"
          href="/tasks"
        />
        <KpiCard
          label="미읽은 알림"
          value={stats.unreadNotifications}
          unit="건"
          accent="text-pink-700"
          href="/notifications"
        />
      </section>

      {/* 파이프라인 6단계 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
            6단계 파이프라인
          </h2>
          <Link
            href="/research"
            className="text-xs font-semibold text-teal-700 hover:text-teal-800"
          >
            새 리서치 시작 →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {stats.pipelineCounts.map((entry, idx) => {
            const meta = STAGE_META[entry.stage];
            return (
              <Link
                key={entry.stage}
                href={meta.href}
                className="group rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${meta.bgColor} ${meta.color}`}
                  >
                    {idx + 1}
                  </div>
                  <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                </div>
                <div className="mt-3 text-2xl font-bold text-navy-900 tabular-nums">
                  {entry.count}
                  <span className="ml-1 text-sm font-normal text-navy-500">개</span>
                </div>
                <div className="mt-1 text-xs text-navy-500 group-hover:text-navy-700">
                  {meta.description}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 빠른 진입 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
          빠른 시작
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <QuickActionCard
            href="/research/coupang-reviews"
            title="쿠팡 리뷰 분석"
            description="경쟁 상품 리뷰를 붙여넣고 핵심 인사이트 자동 추출"
            badge="C-3 신규"
          />
          <QuickActionCard
            href="/sourcing/suppliers/new"
            title="공급사 등록"
            description="새 중국 공급사 정보를 등록하고 견적 시작"
            badge="준비 중"
            disabled
          />
          <QuickActionCard
            href="/settings/tariffs"
            title="관세 프리셋 관리"
            description="시드 데이터로 4종 기본 프리셋 자동 생성됨"
            badge="설정"
          />
        </div>
      </section>

      {/* 회사 컨텍스트 안내 (디버그용 — 운영에서는 제거 가능) */}
      <section className="rounded-lg border border-navy-200 bg-white p-4 text-xs text-navy-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="font-semibold text-navy-700">활성 회사 ID:</span>{' '}
            <code className="text-navy-600">{ctx.companyId}</code>
          </span>
          <span>
            <span className="font-semibold text-navy-700">권한:</span> {ctx.role}
          </span>
          <span>
            <span className="font-semibold text-navy-700">전체 멤버십:</span>{' '}
            {ctx.memberships.length}개 회사
          </span>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  unit: string;
  accent: string;
  href?: string;
}

function KpiCard({ label, value, unit, accent, href }: KpiCardProps) {
  const inner = (
    <div className="rounded-lg border border-navy-200 bg-white p-5 transition hover:border-teal-300">
      <div className="text-xs font-semibold uppercase tracking-wide text-navy-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${accent}`}>
        {value.toLocaleString('ko-KR')}
        <span className="ml-1 text-base font-normal text-navy-500">{unit}</span>
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

interface QuickActionCardProps {
  href: string;
  title: string;
  description: string;
  badge: string;
  disabled?: boolean;
}

function QuickActionCard({ href, title, description, badge, disabled }: QuickActionCardProps) {
  const className =
    'block rounded-lg border border-navy-200 bg-white p-4 transition' +
    (disabled
      ? ' cursor-not-allowed opacity-60'
      : ' hover:border-teal-300 hover:shadow-sm');

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-navy-900">{title}</h3>
        <span className="shrink-0 rounded bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
          {badge}
        </span>
      </div>
      <p className="mt-1 text-xs text-navy-500">{description}</p>
    </>
  );

  if (disabled) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
