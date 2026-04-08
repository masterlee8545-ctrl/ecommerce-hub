/**
 * Next.js 미들웨어 — 인증 가드 + 회사 컨텍스트 헤더 주입
 *
 * 출처: NextAuth.js v5 공식 패턴
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-2 (실패 시 차단)
 *
 * 역할:
 * - 모든 페이지 요청을 가로채서 인증 여부 확인
 * - 비공개 페이지에 미인증 접근 시 /login으로 리디렉션 (auth.config.ts authorized 콜백)
 * - 인증된 요청에는 x-buywise-company-id / x-buywise-user-id 헤더 주입
 *   → 서버 컴포넌트가 이 헤더를 읽어 withCompanyContext에 전달
 *
 * Edge runtime 제약:
 * - bcryptjs, drizzle, postgres 같은 Node 전용 모듈 import 금지
 * - 그래서 auth.config.ts (providers 빈 채)만 사용 — auth.ts는 import 금지
 *
 * matcher:
 * - /api/auth/* 는 NextAuth 자체 핸들러라 통과
 * - /_next, /favicon.ico, 정적 파일은 통과
 * - 나머지 모든 경로는 미들웨어 통과
 */
import NextAuth from 'next-auth';

import { authConfig } from '@/lib/auth/auth.config';

const { auth } = NextAuth(authConfig);

export default auth((_req) => {
  // 헤더 주입은 NextResponse.next 조작이 필요하므로,
  // 인증 컨텍스트 전파는 추후 별도 PR에서 다룬다.
  // 현재는 authorized 콜백이 인증 여부만 검사하면 충분하다.
  return undefined;
});

export const config = {
  matcher: [
    /*
     * 다음 경로는 미들웨어를 건너뜀:
     * - /api/auth/* (NextAuth 자체 핸들러)
     * - /_next/static/*
     * - /_next/image/*
     * - /favicon.ico, /robots.txt 등 루트 정적 파일
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
