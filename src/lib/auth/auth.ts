/**
 * NextAuth v5 — 풀 설정 (Node 런타임 전용)
 *
 * 출처: NextAuth.js v5 공식 패턴
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-2 (실패 시 throw)
 *
 * 역할:
 * - Credentials provider 등록 (이메일 + 비밀번호 로그인)
 * - JWT/session 콜백에서 활성 회사 ID 주입 (멀티테넌트 핵심)
 * - 사용자 정의 필드 (companyId, role) 타입 확장
 *
 * 사용처:
 * - src/app/api/auth/[...nextauth]/route.ts (handlers)
 * - 서버 컴포넌트의 auth() 호출
 * - signIn / signOut 액션
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { authConfig } from './auth.config';
import { authenticateUser, listUserCompanies } from './user';

// ─────────────────────────────────────────────────────────
// 입력 스키마 (런타임 검증 — 헌법 P-2)
// ─────────────────────────────────────────────────────────

const credentialsSchema = z.object({
  email: z.string().email({ message: '이메일 형식이 올바르지 않습니다.' }),
  password: z.string().min(1, { message: '비밀번호를 입력하세요.' }),
});

// ─────────────────────────────────────────────────────────
// NextAuth 인스턴스
// ─────────────────────────────────────────────────────────

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'BUYWISE 계정',
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(rawCredentials) {
        // 1. zod로 입력 검증 (P-2: 추측 금지)
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        // 2. DB에서 사용자 조회 + bcrypt 검증
        const user = await authenticateUser(parsed.data.email, parsed.data.password);
        if (!user) {
          return null;
        }

        // 3. NextAuth User 형식으로 변환 (password_hash는 절대 포함하지 않음)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          // 커스텀 필드는 jwt callback에서 token에 옮겨 담는다
          activeCompanyId: user.activeCompanyId,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * JWT 콜백 — 토큰에 회사 ID와 권한 정보 주입.
     * 로그인 직후 1회 호출, 이후 세션 갱신 시마다 호출.
     */
    async jwt({ token, user, trigger, session }) {
      // 첫 로그인 직후 — user 객체가 존재
      if (user) {
        token.userId = user.id;
        token.email = user.email ?? '';
        token.name = user.name ?? '';

        // 사용자가 속한 회사 목록 조회
        const memberships = await listUserCompanies(user.id ?? '');

        // 활성 회사 결정 우선순위:
        // 1) DB에 저장된 activeCompanyId (이전 세션 마지막 회사)
        // 2) 첫 번째 멤버십
        // 3) 멤버십 0개면 null (공용 페이지만 접근 가능)
        const customUser = user as { activeCompanyId?: string | null };
        const fromDb = customUser.activeCompanyId;
        const fallback = memberships[0]?.companyId ?? null;

        const activeCompanyId =
          fromDb && memberships.some((m) => m.companyId === fromDb) ? fromDb : fallback;

        token.activeCompanyId = activeCompanyId;
        token.role = memberships.find((m) => m.companyId === activeCompanyId)?.role ?? null;
        token.memberships = memberships.map((m) => ({
          companyId: m.companyId,
          role: m.role,
        }));
      }

      // 회사 전환 트리거 — 클라이언트가 update({ activeCompanyId }) 호출 시
      if (trigger === 'update' && session && typeof session === 'object') {
        const updatePayload = session as { activeCompanyId?: string };
        if (updatePayload.activeCompanyId) {
          // 멤버십 검증 (다른 회사로 무단 전환 방지 — P-4)
          const memberships =
            (token.memberships as Array<{ companyId: string; role: string }> | undefined) ?? [];
          const target = memberships.find((m) => m.companyId === updatePayload.activeCompanyId);
          if (target) {
            token.activeCompanyId = updatePayload.activeCompanyId;
            token.role = target.role;
          }
        }
      }

      return token;
    },

    /**
     * Session 콜백 — token의 정보를 클라이언트가 보는 session 객체로 변환.
     * 클라이언트가 useSession() / auth() 호출 시 받는 데이터.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string | undefined) ?? '';
        session.user.activeCompanyId = (token.activeCompanyId as string | null | undefined) ?? null;
        session.user.role = (token.role as 'owner' | 'manager' | 'operator' | null | undefined) ?? null;
        session.user.memberships =
          (token.memberships as Array<{ companyId: string; role: 'owner' | 'manager' | 'operator' }> | undefined) ??
          [];
      }
      return session;
    },
  },
});
