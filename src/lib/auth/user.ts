/**
 * 사용자 도메인 함수 (인증 전용)
 *
 * 출처: docs/DATA_MODEL.md §2.2 (users 표), §2.3 (user_companies 표)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw, 빈 결과 은폐 금지), §1 P-7 (비밀번호 노출 금지)
 *
 * 역할:
 * - 이메일 → 사용자 조회 (RLS 우회 — auth는 회사 컨텍스트 이전에 동작)
 * - 비밀번호 검증
 * - 사용자의 활성 회사 조회
 *
 * 멀티테넌트 안전성:
 * - 이 파일의 함수들은 db 직접 사용 (withCompanyContext 미경유)
 * - 이유: 인증 자체는 "회사 컨텍스트가 없는 상태"에서 동작해야 함
 * - users / user_companies 표는 RLS 미적용 (또는 매우 느슨한 정책) — DATA_MODEL.md §2.3 참조
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { userCompanies, users } from '@/db/schema';

import { verifyPassword } from './password';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

/**
 * 인증 컨텍스트에서 사용하는 사용자 정보 (password_hash 제외).
 * NextAuth User 타입과 호환되는 최소 형태.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  activeCompanyId: string | null;
}

/**
 * 사용자가 속한 회사 1건의 정보 (역할 포함).
 */
export interface UserCompanyMembership {
  companyId: string;
  companyName: string;
  role: 'owner' | 'manager' | 'operator';
}

// ─────────────────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────────────────

/**
 * 이메일로 사용자 조회 (password_hash 포함 — 검증용).
 *
 * @returns 사용자 1건 (없으면 null)
 *
 * 주의:
 * - 이 함수가 반환한 객체는 절대 클라이언트로 전송 금지 (password_hash 포함).
 * - authorize 함수 안에서만 호출, 검증 후 즉시 password_hash 제거.
 */
export async function findUserByEmailWithHash(email: string): Promise<{
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  avatarUrl: string | null;
  activeCompanyId: string | null;
  isActive: boolean;
} | null> {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.password_hash,
      avatarUrl: users.avatar_url,
      activeCompanyId: users.active_company_id,
      isActive: users.is_active,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * 이메일 + 평문 비밀번호로 로그인 검증.
 *
 * @returns 검증 성공 시 AuthenticatedUser, 실패 시 null
 *
 * 사용처: NextAuth Credentials provider의 authorize 함수
 *
 * 보안:
 * - 이메일이 없거나 비밀번호가 틀리거나 계정이 비활성인 경우 모두 null 반환
 *   → 공격자에게 어느 단계에서 실패했는지 알려주지 않음
 * - 항상 verifyPassword까지 호출 (타이밍 공격 방지)
 */
export async function authenticateUser(
  email: string,
  plainPassword: string,
): Promise<AuthenticatedUser | null> {
  const user = await findUserByEmailWithHash(email);

  // 사용자가 없어도 더미 해시 검증을 한 번 수행 (타이밍 공격 방지)
  // 더미 해시는 실제 bcrypt cost 12로 생성된 무의미한 값
  const dummyHash = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8ck7iJU8.JFeYXg3Fz3OXhFe6T1jZi';
  const isValid = await verifyPassword(plainPassword, user?.passwordHash ?? dummyHash);

  if (!user || !isValid || !user.isActive) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    activeCompanyId: user.activeCompanyId,
  };
}

/**
 * 사용자가 속한 회사 목록 조회.
 *
 * @returns 회사 멤버십 배열 (속한 회사가 없으면 빈 배열)
 *
 * 사용처:
 * - NextAuth jwt callback (로그인 시 회사 자동 선택)
 * - 회사 전환 드롭다운 (UI)
 */
export async function listUserCompanies(userId: string): Promise<UserCompanyMembership[]> {
  if (!userId) {
    return [];
  }

  const rows = await db
    .select({
      companyId: userCompanies.company_id,
      role: userCompanies.role,
    })
    .from(userCompanies)
    .where(eq(userCompanies.user_id, userId));

  // 회사 이름은 별도 조회 (RLS 안전 — userCompanies join 대신 in 절 사용)
  if (rows.length === 0) {
    return [];
  }

  // role 안전 캐스팅 (DB는 text라 런타임 검증 필요)
  return rows
    .filter((r): r is { companyId: string; role: 'owner' | 'manager' | 'operator' } =>
      ['owner', 'manager', 'operator'].includes(r.role),
    )
    .map((r) => ({
      companyId: r.companyId,
      companyName: '', //  실제 이름은 호출자가 별도 join 조회 (회사 컨텍스트 안에서)
      role: r.role,
    }));
}

/**
 * 특정 회사 의 멤버 전원 조회 (담당자 배정 드롭다운용).
 *
 * 반환: 이름·이메일 포함. password_hash 는 절대 내보내지 않음.
 * 활성 사용자(is_active) 만 포함.
 */
export interface CompanyMember {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'manager' | 'operator';
}

export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  if (!companyId) return [];
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.is_active,
      role: userCompanies.role,
    })
    .from(userCompanies)
    .innerJoin(users, eq(users.id, userCompanies.user_id))
    .where(eq(userCompanies.company_id, companyId));

  return rows
    .filter((r) => r.isActive === true)
    .filter((r): r is { id: string; email: string; name: string; isActive: boolean; role: 'owner' | 'manager' | 'operator' } =>
      ['owner', 'manager', 'operator'].includes(r.role),
    )
    .map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role }));
}

/**
 * 사용자가 특정 회사의 멤버인지 확인.
 *
 * 사용처:
 * - 회사 전환 시 권한 검증
 * - 미들웨어에서 잘못된 활성 회사 ID 차단
 */
export async function isUserMemberOfCompany(
  userId: string,
  companyId: string,
): Promise<boolean> {
  if (!userId || !companyId) {
    return false;
  }

  const rows = await db
    .select({ id: userCompanies.id })
    .from(userCompanies)
    .where(and(eq(userCompanies.user_id, userId), eq(userCompanies.company_id, companyId)))
    .limit(1);

  return rows.length > 0;
}
