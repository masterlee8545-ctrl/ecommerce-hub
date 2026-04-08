/**
 * NextAuth v5 — 타입 확장
 *
 * 출처: https://authjs.dev/getting-started/typescript
 *
 * 역할:
 * - Session.user에 커스텀 필드(activeCompanyId, role, memberships) 추가
 * - JWT 토큰에 동일한 필드 추가
 *
 * 이 파일은 .d.ts라 빌드 결과물에 포함되지 않고 타입 정의만 제공.
 */
import type { DefaultSession } from 'next-auth';

export type CompanyRole = 'owner' | 'manager' | 'operator';

export interface Membership {
  companyId: string;
  role: CompanyRole;
}

declare module 'next-auth' {
  /**
   * 클라이언트에 노출되는 session.user 객체.
   */
  interface Session {
    user: {
      id: string;
      activeCompanyId: string | null;
      role: CompanyRole | null;
      memberships: Membership[];
    } & DefaultSession['user'];
  }

  /**
   * authorize() 반환값 / NextAuth 내부에서 다루는 User 객체.
   */
  interface User {
    activeCompanyId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  /**
   * jwt() 콜백에서 다루는 토큰.
   */
  interface JWT {
    userId: string;
    activeCompanyId: string | null;
    role: CompanyRole | null;
    memberships: Membership[];
  }
}
