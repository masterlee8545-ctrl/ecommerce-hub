/**
 * 회원가입 비즈니스 로직 (Phase D)
 *
 * 출처: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트), §1 P-7 (비번 해시)
 * 장기 비전: 강의 수강생 확장 시에도 각자 자기 법인 owner 로 들어오는 패턴.
 *
 * 역할:
 * - 신규 가입: companies → users → user_companies 3개 테이블을 트랜잭션으로 생성
 * - 새로 가입한 사용자는 자기가 만든 법인의 owner
 * - 이메일 중복, 법인명 공백, 약한 비번 등 사전 검증
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { companies, userCompanies, users } from '@/db/schema';

import { hashPassword, validatePasswordFormat } from './password';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export type BusinessType = 'industrial' | 'agricultural' | 'other';

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  companyName: string;
  businessType: BusinessType;
  representative?: string;
}

export interface SignUpResult {
  userId: string;
  companyId: string;
  email: string;
  name: string;
  companyName: string;
}

export class SignUpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'email_invalid'
      | 'email_taken'
      | 'password_invalid'
      | 'name_required'
      | 'company_name_required'
      | 'business_type_invalid',
  ) {
    super(message);
    this.name = 'SignUpError';
  }
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateInput(input: SignUpInput): void {
  const email = normalizeEmail(input.email);
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new SignUpError('이메일 형식이 올바르지 않습니다.', 'email_invalid');
  }
  const passwordError = validatePasswordFormat(input.password);
  if (passwordError) {
    throw new SignUpError(passwordError, 'password_invalid');
  }
  if (!input.name?.trim()) {
    throw new SignUpError('이름을 입력하세요.', 'name_required');
  }
  if (!input.companyName?.trim()) {
    throw new SignUpError('법인/사업체명을 입력하세요.', 'company_name_required');
  }
  if (!['industrial', 'agricultural', 'other'].includes(input.businessType)) {
    throw new SignUpError('사업 유형 선택이 잘못됐습니다.', 'business_type_invalid');
  }
}

// ─────────────────────────────────────────────────────────
// 핵심: 회원가입 트랜잭션
// ─────────────────────────────────────────────────────────

/**
 * 새 사용자 + 새 법인 + 멤버십(owner) 을 한 번에 생성.
 *
 * 실패 시 throw (중복 이메일·형식 오류·DB 제약 위반 등).
 * 성공 시 생성된 userId·companyId 반환.
 */
export async function signUpUser(input: SignUpInput): Promise<SignUpResult> {
  validateInput(input);

  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const companyName = input.companyName.trim();
  const representative = input.representative?.trim() || name;

  // 이메일 중복 사전 체크 (트랜잭션 밖에서 빠르게 실패)
  const dup = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (dup.length > 0) {
    throw new SignUpError('이미 가입된 이메일입니다.', 'email_taken');
  }

  const passwordHash = await hashPassword(input.password);

  // 트랜잭션: 법인 → 사용자 → 멤버십
  return db.transaction(async (tx) => {
    // 1) 법인 생성
    const [company] = await tx
      .insert(companies)
      .values({
        name: companyName,
        business_type: input.businessType,
        representative,
        default_currency: 'KRW',
      })
      .returning({ id: companies.id, name: companies.name });
    if (!company) throw new Error('[signUpUser] 법인 INSERT 실패');

    // 2) 사용자 생성 — active_company_id 는 방금 만든 법인
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name,
        password_hash: passwordHash,
        active_company_id: company.id,
        is_active: true,
      })
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!user) throw new Error('[signUpUser] 사용자 INSERT 실패');

    // 3) 멤버십 생성 — 본인 법인의 owner
    await tx.insert(userCompanies).values({
      user_id: user.id,
      company_id: company.id,
      role: 'owner',
    });

    return {
      userId: user.id,
      companyId: company.id,
      email: user.email,
      name: user.name,
      companyName: company.name,
    };
  });
}
