/**
 * /research — 리서치 단계 진입 페이지
 *
 * 출처: docs/SPEC.md §3 Research, 6단계 파이프라인 1단계
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 리서치 단계의 도구 카드 모음 (쿠팡 리뷰 분석, 트렌드, 키워드 분석 등)
 * - 인증된 사용자만 접근 — requireCompanyContext()로 보호
 *
 * 구조:
 * - 도구 카드 그리드 (4종)
 *   1) 쿠팡 리뷰 분석기 (C-3 — 사용 가능)
 *   2) 키워드 트렌드 (C-4 — 준비 중)
 *   3) BW Rank 키워드 분석 (Phase 2)
 *   4) 시장 난이도 판정 (ADR-008, Phase 2)
 */
import Link from 'next/link';

import { BarChart3, FileSearch, Sparkles, TrendingUp } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface ResearchTool {
  href: string;
  title: string;
  description: string;
  icon: typeof FileSearch;
  status: 'available' | 'coming-soon' | 'phase2';
  badge: string;
}

const RESEARCH_TOOLS: ResearchTool[] = [
  {
    href: '/research/coupang-reviews',
    title: '쿠팡 리뷰 분석기',
    description: '경쟁 상품의 쿠팡 리뷰를 붙여넣으면 AI가 불만, 장점, 차별화 포인트를 자동 추출합니다.',
    icon: FileSearch,
    status: 'available',
    badge: 'C-3 신규',
  },
  {
    href: '/research/trends',
    title: '키워드 트렌드',
    description: 'InfoHub와 연결된 최신 트렌드 카드를 모아봅니다 (유튜브 / 블로그 / 뉴스).',
    icon: TrendingUp,
    status: 'available',
    badge: 'C-4 신규',
  },
  {
    href: '/research/keywords',
    title: 'BW Rank 키워드 분석',
    description: '월간 검색량, 경쟁률, 광고 단가를 한 번에 조회합니다. (자체 인프라)',
    icon: BarChart3,
    status: 'phase2',
    badge: 'Phase 2',
  },
  {
    href: '/research/difficulty',
    title: '시장 난이도 판정',
    description: '쿠팡 1페이지 리뷰 분포로 진입 가능 여부를 자동 판정합니다 (ADR-008).',
    icon: Sparkles,
    status: 'phase2',
    badge: 'Phase 2',
  },
];

export default async function ResearchPage() {
  const ctx = await requireCompanyContext();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-600">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold">
            1
          </span>
          파이프라인 1단계
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">리서치</h1>
        <p className="mt-1 text-sm text-navy-500">
          새로운 상품 후보를 찾기 위한 도구 모음입니다. 분석 결과는 모두{' '}
          <span className="rounded bg-yellow-50 px-1.5 py-0.5 text-[11px] font-semibold text-yellow-700">
            🟡 추정값
          </span>{' '}
          이며 회계 계산에는 사용할 수 없습니다.
        </p>
      </header>

      {/* 도구 카드 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
          분석 도구
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {RESEARCH_TOOLS.map((tool) => (
            <ToolCard key={tool.href} tool={tool} />
          ))}
        </div>
      </section>

      {/* 컨텍스트 디버그 (운영에서 제거 가능) */}
      <section className="rounded-lg border border-navy-200 bg-white p-4 text-xs text-navy-500">
        <span>
          <span className="font-semibold text-navy-700">활성 회사:</span>{' '}
          <code className="text-navy-600">{ctx.companyId}</code>
        </span>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 카드 컴포넌트
// ─────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ResearchTool }) {
  const Icon = tool.icon;
  const isAvailable = tool.status === 'available';

  const badgeColor =
    tool.status === 'available'
      ? 'bg-teal-50 text-teal-700'
      : tool.status === 'coming-soon'
        ? 'bg-yellow-50 text-yellow-700'
        : 'bg-navy-50 text-navy-500';

  const cardClass = isAvailable
    ? 'block rounded-lg border border-navy-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-sm'
    : 'block rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-5 cursor-not-allowed';

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            isAvailable ? 'bg-teal-50 text-teal-700' : 'bg-navy-100 text-navy-400'
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${badgeColor}`}
        >
          {tool.badge}
        </span>
      </div>
      <h3
        className={`mt-3 font-semibold ${isAvailable ? 'text-navy-900' : 'text-navy-500'}`}
      >
        {tool.title}
      </h3>
      <p className="mt-1 text-xs text-navy-500">{tool.description}</p>
    </>
  );

  if (isAvailable) {
    return (
      <Link href={tool.href} className={cardClass}>
        {inner}
      </Link>
    );
  }
  return <div className={cardClass}>{inner}</div>;
}
