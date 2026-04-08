/**
 * (app) 그룹 레이아웃 — 인증된 페이지의 공통 껍데기
 *
 * 출처: Next.js 15 App Router 라우트 그룹 패턴
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 사이드바 + 헤더 + 콘텐츠 영역의 3열/2단 레이아웃
 * - 인증되지 않은 사용자는 헤더에서 자동으로 /login 으로 보냄
 *   (Header → requireCompanyContext → redirect)
 *
 * 라우트 그룹 (app):
 * - URL에는 영향 없음 — / 는 그대로 /
 * - (auth) 와 별도 layout 적용 가능
 *
 * 적용 페이지:
 * - / (홈 대시보드)
 * - /research/* (리서치 단계)
 * - /sourcing/*, /importing/*, /listing/*, /active/*, /branding/*
 * - /tasks, /notifications, /settings, /ads
 */
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen bg-navy-50">
      {/* 좌측 고정 사이드바 */}
      <Sidebar />

      {/* 우측 메인 영역 */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* 헤더 (서버 컴포넌트 — 회사 컨텍스트 강제) */}
        <Header />

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
