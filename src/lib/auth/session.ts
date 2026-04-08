/**
 * 서버 컴포넌트용 세션 헬퍼
 *
 * 출처: NextAuth v5 server-side 패턴
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4 (멀티테넌트 격리)
 *
 * 역할:
 * - 서버 컴포넌트/Route Handler에서 현재 로그인 사용자 정보 가져오기
 * - 활성 회사 ID 추출
 * - 회사 컨텍스트가 없으면 명시적 에러 (P-4 강제)
 *
 * 사용처:
 * - app/(app)/page.tsx 같은 보호된 페이지
 * - app/api/* Route Handler
 *
 * 사용 예:
 * ```ts
 * const { userId, companyId, role } = await requireCompanyContext();
 * const products = await withCompanyContext(companyId, (tx) => tx.select()...);
 * ```
 */
import { redirect } from 'next/navigation';

import type { CompanyRole, Membership } from '@/types/next-auth';

import { auth } from './auth';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

/**
 * 인증된 컨텍스트 — 회사 ID 포함.
 *
 * 이 객체가 반환되면 다음이 보장된다:
 * - 사용자가 로그인되어 있다
 * - 적어도 1개 회사에 멤버십이 있다
 * - 활성 회사 ID가 결정되어 있다
 */
export interface AuthenticatedContext {
  userId: string;
  email: string;
  name: string;
  companyId: string;
  role: CompanyRole;
  memberships: Membership[];
}

/**
 * 회사 컨텍스트가 없을 수도 있는 약한 형태.
 * (예: 로그인은 했지만 아직 어느 회사에도 속하지 않은 신규 사용자)
 */
export interface OptionalAuthenticatedContext {
  userId: string;
  email: string;
  name: string;
  companyId: string | null;
  role: CompanyRole | null;
  memberships: Membership[];
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

/**
 * 현재 세션을 가져오되, 미인증이면 /login으로 리디렉션.
 *
 * 회사 멤버십이 없어도 통과 — 회사 가입/생성 페이지로 보내야 할 때 사용.
 */
export async function requireSession(): Promise<OptionalAuthenticatedContext> {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    companyId: session.user.activeCompanyId,
    role: session.user.role,
    memberships: session.user.memberships,
  };
}

/**
 * 회사 컨텍스트가 반드시 있어야 하는 페이지에서 사용.
 *
 * 검증 흐름:
 * 1. 미인증 → /login
 * 2. 인증됐지만 멤버십 0개 → /login?error=no-membership (향후 /onboarding 신설 예정)
 * 3. 인증 + 멤버십 있는데 activeCompanyId가 멤버십에 없음 → /login (세션 깨짐)
 *
 * @returns 100% 안전한 회사 컨텍스트
 */
export async function requireCompanyContext(): Promise<AuthenticatedContext> {
  const session = await requireSession();

  // 멤버십 0개 — 회사 가입/생성 흐름으로 (현재는 /login으로 폴백)
  if (session.memberships.length === 0) {
    // 향후 onboarding 페이지가 생기면 redirect('/onboarding')
    redirect('/login?error=no-membership');
  }

  // 활성 회사 ID가 없거나 멤버십에 없음 — 비정상 상태
  if (!session.companyId || !session.role) {
    redirect('/login?error=no-active-company');
  }

  // 활성 회사가 멤버십에 실제 존재하는지 검증 (P-4 — 무단 전환 방지)
  const matchingMembership = session.memberships.find(
    (m) => m.companyId === session.companyId,
  );
  if (!matchingMembership) {
    redirect('/login?error=invalid-active-company');
  }

  return {
    userId: session.userId,
    email: session.email,
    name: session.name,
    companyId: session.companyId,
    role: session.role,
    memberships: session.memberships,
  };
}

/**
 * 세션을 가져오되, 없어도 null 반환 (리디렉션 안 함).
 *
 * 사용처: 헤더 같은 공통 컴포넌트가 로그인 여부에 따라 다른 UI 보여줄 때.
 */
export async function getOptionalSession(): Promise<OptionalAuthenticatedContext | null> {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    companyId: session.user.activeCompanyId,
    role: session.user.role,
    memberships: session.user.memberships,
  };
}
