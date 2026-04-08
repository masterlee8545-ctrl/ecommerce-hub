/**
 * 로그인 페이지 — Server Action
 *
 * 출처: Next.js 15 Server Actions + NextAuth v5 signIn
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * 역할:
 * - 폼 데이터 받아서 NextAuth signIn('credentials') 호출
 * - 성공 → / 로 리디렉션
 * - 실패 → 에러 메시지 반환 (사용자에게 보여줌)
 */
'use server';

import { AuthError } from 'next-auth';
import { z } from 'zod';

import { signIn } from '@/lib/auth/auth';

const loginSchema = z.object({
  email: z.string().email({ message: '이메일 형식이 올바르지 않습니다.' }),
  password: z.string().min(1, { message: '비밀번호를 입력하세요.' }),
});

export interface LoginActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
}

/**
 * 로그인 폼 제출 핸들러.
 * useActionState로 호출되며, 이전 상태와 새 FormData를 받는다.
 */
export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  // 1. 입력 검증
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LoginActionState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'email') fieldErrors.email = issue.message;
      if (path === 'password') fieldErrors.password = issue.message;
    }
    return {
      ok: false,
      error: '입력값을 확인해주세요.',
      fieldErrors,
    };
  }

  // 2. NextAuth signIn 호출
  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/',
    });
    // signIn은 성공 시 redirect throw — 여기 도달하지 않음
    return { ok: true };
  } catch (error) {
    // NextAuth는 redirect를 throw로 표현 — 그건 정상 동작
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error;
    }

    if (error instanceof AuthError) {
      // CredentialsSignin = 이메일/비밀번호 불일치
      if (error.type === 'CredentialsSignin') {
        return {
          ok: false,
          error: '이메일 또는 비밀번호가 올바르지 않습니다.',
        };
      }
      return {
        ok: false,
        error: `로그인 실패: ${error.type}`,
      };
    }

    // NEXT_REDIRECT는 위에서 처리함 — 여기 오는 건 진짜 에러
    throw error;
  }
}
