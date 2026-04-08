/**
 * 헤더 — 서버 컴포넌트
 *
 * 출처: 모든 인증된 페이지 상단 바
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 회사 전환 드롭다운 (활성 회사 표시)
 * - 사용자 메뉴 (로그아웃)
 * - 페이지 제목 표시 영역 (children prop)
 *
 * 구조:
 * - 서버 컴포넌트 — 세션·회사 목록을 서버에서 미리 조회
 * - 상호작용 부분만 클라이언트 컴포넌트 (CompanySwitcher, UserMenu)
 */
import { listCompaniesForUser } from '@/lib/auth/company';
import { requireCompanyContext } from '@/lib/auth/session';

import { CompanySwitcher } from './company-switcher';
import { UserMenu } from './user-menu';

interface HeaderProps {
  /** 페이지 제목 (선택) */
  title?: string;
  /** 페이지 부제 (선택) */
  subtitle?: string;
}

export async function Header({ title, subtitle }: HeaderProps) {
  // 보호된 페이지에서만 사용 — 회사 컨텍스트 강제
  const ctx = await requireCompanyContext();
  const companies = await listCompaniesForUser(ctx.userId);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-navy-200 bg-white px-6">
      {/* 좌측 — 페이지 제목 */}
      <div className="min-w-0 flex-1">
        {title && (
          <h1 className="truncate text-base font-semibold text-navy-900">{title}</h1>
        )}
        {subtitle && <p className="truncate text-xs text-navy-500">{subtitle}</p>}
      </div>

      {/* 우측 — 회사 전환 + 사용자 메뉴 */}
      <div className="flex items-center gap-3">
        <CompanySwitcher activeCompanyId={ctx.companyId} companies={companies} />
        <UserMenu name={ctx.name} email={ctx.email} />
      </div>
    </header>
  );
}
