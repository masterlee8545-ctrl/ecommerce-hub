/**
 * 회원가입 Server Action (Phase D)
 *
 * 흐름:
 * 1. FormData 검증 (zod)
 * 2. signUpUser(입력) — 법인·사용자·멤버십 트랜잭션 생성
 * 3. 바로 로그인 시도 (NextAuth signIn) → 성공 시 '/' 리디렉션
 * 4. 가입은 성공했지만 로그인 실패 시 /login 으로 이메일 프리필해서 보냄
 */
'use server';

import { AuthError } from 'next-auth';
import { z } from 'zod';

import { signIn } from '@/lib/auth/auth';
import { signUpUser, SignUpError, type BusinessType } from '@/lib/auth/signup';

const signUpSchema = z.object({
  email: z.string().email({ message: '이메일 형식이 올바르지 않습니다.' }),
  password: z
    .string()
    .min(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    .max(72, { message: '비밀번호는 최대 72자까지 가능합니다.' }),
  name: z.string().min(1, { message: '이름을 입력하세요.' }),
  companyName: z.string().min(1, { message: '법인/사업체명을 입력하세요.' }),
  businessType: z.enum(['industrial', 'agricultural', 'other']),
});

export interface SignUpActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    name?: string;
    companyName?: string;
    businessType?: string;
  };
}

export async function signUpAction(
  _prevState: SignUpActionState,
  formData: FormData,
): Promise<SignUpActionState> {
  // 1) 입력 검증
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
    name: formData.get('name'),
    companyName: formData.get('companyName'),
    businessType: formData.get('businessType'),
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: SignUpActionState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'email') fieldErrors.email = issue.message;
      if (path === 'password') fieldErrors.password = issue.message;
      if (path === 'name') fieldErrors.name = issue.message;
      if (path === 'companyName') fieldErrors.companyName = issue.message;
      if (path === 'businessType') fieldErrors.businessType = issue.message;
    }
    return { ok: false, error: '입력값을 확인해주세요.', fieldErrors };
  }

  // 2) DB 트랜잭션으로 가입
  try {
    await signUpUser({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      businessType: parsed.data.businessType as BusinessType,
    });
  } catch (err) {
    if (err instanceof SignUpError) {
      const fe: SignUpActionState['fieldErrors'] = {};
      if (err.code === 'email_taken' || err.code === 'email_invalid') fe.email = err.message;
      if (err.code === 'password_invalid') fe.password = err.message;
      if (err.code === 'name_required') fe.name = err.message;
      if (err.code === 'company_name_required') fe.companyName = err.message;
      if (err.code === 'business_type_invalid') fe.businessType = err.message;
      return { ok: false, error: err.message, fieldErrors: fe };
    }
    console.error('[signUpAction] 가입 실패:', err);
    return {
      ok: false,
      error: err instanceof Error ? `가입 실패: ${err.message}` : '가입 중 오류가 발생했습니다.',
    };
  }

  // 3) 바로 로그인
  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/',
    });
    return { ok: true };
  } catch (error) {
    // NextAuth redirect 는 throw 로 표현 — 정상 동작
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error;
    }
    if (error instanceof AuthError) {
      // 가입은 됐지만 자동 로그인 실패 — 로그인 페이지로
      return {
        ok: false,
        error: '가입은 완료됐습니다. 로그인 페이지에서 다시 로그인해주세요.',
      };
    }
    throw error;
  }
}
