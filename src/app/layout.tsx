/**
 * Root Layout — Next.js 15 App Router
 *
 * 출처: Next.js 15 App Router 표준
 *
 * 역할:
 * - 모든 페이지를 감싸는 최상위 레이아웃
 * - 한국어(ko) 언어 설정
 * - 전역 메타데이터
 * - globals.css 로드 (Tailwind + Pretendard)
 *
 * 향후 추가 예정:
 * - NextAuth SessionProvider
 * - ThemeProvider (light/dark)
 * - Toast/Sonner 컨테이너
 * - 회사 컨텍스트 Provider
 */
import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BUYWISE 이커머스 통합관리',
    template: '%s | BUYWISE',
  },
  description: '6단계 파이프라인으로 상품 라이프사이클을 한 곳에서 관리하는 멀티테넌트 시스템',
  applicationName: 'BUYWISE Hub',
  authors: [{ name: 'BUYWISE.CO' }],
  keywords: ['이커머스', '상품관리', '소싱', '쿠팡', '네이버', '광고관리'],
  robots: {
    index: false, //   내부 시스템 — 검색엔진 색인 금지
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0D9488', // BUYWISE Teal
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
