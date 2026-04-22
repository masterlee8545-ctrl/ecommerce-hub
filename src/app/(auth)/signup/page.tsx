/**
 * 회원가입 페이지 (/signup) — Phase D
 *
 * 가입하면 자동으로 본인 소유 법인이 생성되고 그 법인의 owner 로 등록됨.
 * 이후 3법인 체계(바이와이즈 등)와 분리된 독립 테넌트.
 */
import Link from 'next/link';

import { SignUpForm } from './signup-form';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '회원가입',
};

export default function SignUpPage() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-navy-900">회원가입</h2>
        <p className="mt-1 text-sm text-navy-500">
          이커머스 허브를 처음 이용하시나요? 계정과 법인을 함께 만들어드립니다.
        </p>
      </div>

      <SignUpForm />

      <p className="mt-6 border-t border-navy-200 pt-4 text-center text-xs text-navy-500">
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="font-semibold text-teal-700 hover:text-teal-800 hover:underline">
          로그인
        </Link>
      </p>
    </>
  );
}
