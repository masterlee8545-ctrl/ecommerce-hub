/**
 * 사이드바 — 6단계 파이프라인 네비게이션
 *
 * 출처: docs/SPEC.md (6단계 파이프라인), docs/DATA_MODEL.md
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 좌측 고정 사이드바
 * - 6단계 (Research → Sourcing → Importing → Listing → Active → Branding) 네비
 * - 운영(Operations) 섹션 (작업, 광고, SEO, 알림)
 * - 현재 활성 경로 강조
 *
 * 구조:
 * - 서버 컴포넌트로 시작 (현재 활성 경로 판단은 클라이언트가 필요)
 *   → "use client" 처리해서 usePathname 사용
 *
 * 디자인:
 * - 너비 고정 240px
 * - 단계 번호 색상 점 + 라벨
 * - 호버 시 teal-50 배경
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────
// 네비 메뉴 정의
// ─────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  description: string;
  /** 단계 번호 (1~6) — 파이프라인만 표시 */
  step?: number;
  /** 색상 토큰 (Tailwind class) */
  dotColor?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: '상품 파이프라인',
    items: [
      {
        step: 1,
        href: '/research',
        label: '상품 발굴',
        description: '키워드 조사 + 리뷰 검증',
        dotColor: 'bg-blue-500',
      },
      {
        step: 2,
        href: '/sourcing',
        label: '수입 의뢰',
        description: '견적 요청 + 원가 산정',
        dotColor: 'bg-yellow-500',
      },
      {
        step: 3,
        href: '/importing',
        label: '수입중',
        description: '발주 + 배송 추적',
        dotColor: 'bg-purple-500',
      },
      {
        step: 4,
        href: '/listing',
        label: '상세페이지/등록',
        description: '디자인 + 쿠팡/네이버 등록',
        dotColor: 'bg-orange-500',
      },
      {
        step: 5,
        href: '/active',
        label: '런칭/마케팅',
        description: '로켓 + 리뷰 + 블로그 + 바이럴',
        dotColor: 'bg-teal-600',
      },
    ],
  },
  {
    title: '공급처 관리',
    items: [
      { href: '/vendors', label: '농가 검색', description: '1,835명 농가/수산물 도매 풀' },
      { href: '/vendors/discover', label: '외부 발굴', description: '네이버 + 카카오 검색' },
      { href: '/vendors/import', label: 'CSV 임포트', description: '사이소/김제몰 데이터' },
    ],
  },
  {
    title: '운영',
    items: [
      { href: '/products', label: '전체 상품', description: '상품 목록 + 현황' },
      { href: '/tasks', label: '할 일', description: '내 작업 보드' },
      { href: '/notifications', label: '알림', description: '시스템 알림' },
      { href: '/settings', label: '설정', description: '회사 · 사용자' },
    ],
  },
];

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start border-r border-navy-200/70 bg-white/80 backdrop-blur-sm md:flex">
      {/* 로고 */}
      <div className="flex h-16 items-center gap-2.5 border-b border-navy-200/70 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-base font-black text-white shadow-md shadow-teal-600/25">
          B
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-navy-900">BUYWISE.CO</div>
          <div className="text-[11px] text-navy-500">이커머스 통합관리</div>
        </div>
      </div>

      {/* 홈 */}
      <div className="border-b border-navy-200/70 px-3 py-3">
        <SidebarLink
          href="/"
          label="홈 대시보드"
          description="전체 현황"
          isActive={pathname === '/'}
        />
      </div>

      {/* 섹션들 */}
      <nav className="scrollbar-slim flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-6">
            <h3 className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-400">
              {section.title}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                // exactOptionalPropertyTypes — undefined 명시적 처리
                const linkProps: SidebarLinkProps = {
                  href: item.href,
                  label: item.label,
                  description: item.description,
                  isActive,
                  ...(item.step !== undefined && { step: item.step }),
                  ...(item.dotColor !== undefined && { dotColor: item.dotColor }),
                };
                return (
                  <li key={item.href}>
                    <SidebarLink {...linkProps} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* 푸터 */}
      <div className="border-t border-navy-200 px-5 py-3 text-xs text-navy-500">
        © 2026 BUYWISE.CO
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────
// 사이드바 링크 (단일 항목)
// ─────────────────────────────────────────────────────────

interface SidebarLinkProps {
  href: string;
  label: string;
  description: string;
  step?: number;
  dotColor?: string;
  isActive: boolean;
}

function SidebarLink({ href, label, description, step, dotColor, isActive }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors duration-150',
        isActive
          ? 'bg-teal-50 text-teal-700'
          : 'text-navy-700 hover:bg-navy-100/70 hover:text-navy-900',
      )}
    >
      {/* 액티브 좌측 액센트 바 */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-teal-600"
          aria-hidden
        />
      )}

      {/* 단계 번호 점 */}
      {step !== undefined ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
          <div
            className={cn(
              'h-2.5 w-2.5 rounded-full ring-2 ring-transparent transition group-hover:ring-navy-100',
              dotColor ?? 'bg-navy-300',
            )}
            aria-hidden
          />
        </div>
      ) : (
        <div className="h-6 w-6 shrink-0" aria-hidden />
      )}

      {/* 라벨 + 설명 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {step !== undefined && (
            <span className="text-[10px] font-semibold text-navy-400 tabular-nums">
              {step}단계
            </span>
          )}
          <span className="truncate font-medium">{label}</span>
        </div>
        <div className="truncate text-xs text-navy-500">{description}</div>
      </div>
    </Link>
  );
}
