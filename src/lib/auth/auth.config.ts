/**
 * NextAuth v5 — Edge 런타임 호환 설정
 *
 * 출처: NextAuth.js v5 공식 패턴 (https://authjs.dev/getting-started/migrating-to-v5)
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-7 (비밀 노출 금지)
 *
 * 역할:
 * - 미들웨어(Edge runtime)와 풀 NextAuth 설정(Node runtime) 양쪽에서 공유하는 기본 설정
 * - Node 전용 의존성(bcryptjs, drizzle, pg) 절대 import 금지
 *
 * 분리 이유:
 * - 미들웨어는 모든 요청에서 실행되므로 Edge runtime이어야 함 (빠른 콜드스타트)
 * - bcryptjs/postgres 같은 Node 전용 모듈은 Edge에서 쓸 수 없음
 * - 그래서 providers 배열은 빈 채로 두고, 풀 설정(auth.ts)에서 providers를 추가
 *
 * 주의:
 * - 이 파일을 직접 import 하는 코드는 미들웨어/Edge 코드뿐이어야 한다.
 * - DB 호출은 callbacks 안에서만 — 그것도 풀 설정(auth.ts)에서.
 */
import type { NextAuthConfig } from 'next-auth';

// 세션 수명 상수 (초 단위)
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const SESSION_MAX_AGE_SEC = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY * DAYS_PER_WEEK; // 7일
const SESSION_UPDATE_AGE_SEC = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY; //              24시간

// 보호되지 않는 공용 경로 (인증 없이 접근 가능)
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/health'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const authConfig: NextAuthConfig = {
  // Credentials provider는 풀 설정(auth.ts)에서 추가한다 (bcryptjs는 Node 전용).
  providers: [],

  // JWT 세션 전략 — DB 세션 저장 안 함 (멀티테넌트 RLS와 무관하게 빠르게 동작)
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SEC, //      7일
    updateAge: SESSION_UPDATE_AGE_SEC, // 24시간마다 토큰 자동 갱신
  },

  // 페이지 경로 커스터마이즈
  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    /**
     * 미들웨어에서 호출되는 권한 확인 콜백.
     * 반환값:
     * - true   → 통과
     * - false  → /login으로 리디렉션
     * - Response → 직접 응답 반환
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;
      const isPublic = isPublicPath(pathname);

      // 공용 경로는 항상 통과
      if (isPublic) {
        // 이미 로그인한 상태에서 /login 접근 시 홈으로 리디렉션
        if (isLoggedIn && pathname === '/login') {
          return Response.redirect(new URL('/', request.nextUrl));
        }
        return true;
      }

      // 비공개 경로는 로그인 필요
      return isLoggedIn;
    },
  },

  // 보안 — production에서는 secure cookie 강제
  trustHost: true,
};
