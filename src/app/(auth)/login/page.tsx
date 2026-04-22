/**
 * 로그인 페이지 (/login)
 *
 * 출처: Next.js 15 App Router + NextAuth v5
 *
 * 역할:
 * - 이메일/비밀번호 로그인 UI
 * - 인증 미들웨어가 보호하는 페이지에 접근하려다 리디렉션된 사용자 진입점
 *
 * 구조:
 * - 이 page.tsx는 서버 컴포넌트 (메타데이터 설정 + 정적 콘텐츠)
 * - 실제 인터랙티브 폼은 LoginForm (클라이언트 컴포넌트)
 */
import Link from 'next/link';

import { LoginForm } from './login-form';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '로그인',
};

export default function LoginPage() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-navy-900">로그인</h2>
        <p className="mt-1 text-sm text-navy-500">계정 정보를 입력해주세요.</p>
      </div>

      <LoginForm />

      <p className="mt-6 border-t border-navy-200 pt-4 text-center text-xs text-navy-500">
        계정이 없으신가요?{' '}
        <Link href="/signup" className="font-semibold text-teal-700 hover:text-teal-800 hover:underline">
          회원가입
        </Link>
      </p>
    </>
  );
}
