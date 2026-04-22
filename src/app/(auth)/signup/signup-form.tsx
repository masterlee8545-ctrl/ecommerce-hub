/**
 * 회원가입 폼 — 클라이언트 컴포넌트
 */
'use client';

import { useActionState } from 'react';

import { signUpAction, type SignUpActionState } from './actions';

const initialState: SignUpActionState = { ok: false };

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {/* 이메일 */}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-navy-900">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder="you@yourcompany.co"
          className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
        />
        {state.fieldErrors?.email && (
          <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.email}</p>
        )}
      </div>

      {/* 이름 */}
      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-navy-900">
          이름
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          disabled={isPending}
          placeholder="홍길동"
          className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
        />
        {state.fieldErrors?.name && (
          <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.name}</p>
        )}
      </div>

      {/* 비밀번호 */}
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-navy-900">
          비밀번호
          <span className="ml-1 text-[10px] font-normal text-navy-500">(8자 이상)</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          disabled={isPending}
          placeholder="••••••••"
          className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
        />
        {state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.password}</p>
        )}
      </div>

      <div className="border-t border-navy-200 pt-4">
        <p className="mb-3 text-xs text-navy-500">
          가입 시 귀하 소유의 법인/사업체가 자동 생성됩니다. 이후 이 법인에서 상품 소싱·마케팅을 관리하게 됩니다.
        </p>

        {/* 법인명 */}
        <div className="mb-4">
          <label htmlFor="companyName" className="mb-1.5 block text-sm font-medium text-navy-900">
            법인/사업체명
          </label>
          <input
            id="companyName"
            name="companyName"
            type="text"
            required
            disabled={isPending}
            placeholder="예: 홍길동상사"
            className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
          />
          {state.fieldErrors?.companyName && (
            <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.companyName}</p>
          )}
        </div>

        {/* 사업 유형 */}
        <div>
          <label htmlFor="businessType" className="mb-1.5 block text-sm font-medium text-navy-900">
            사업 유형
          </label>
          <select
            id="businessType"
            name="businessType"
            required
            disabled={isPending}
            defaultValue="industrial"
            className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
          >
            <option value="industrial">공산품 (생활용품·가전 등)</option>
            <option value="agricultural">농산물</option>
            <option value="other">기타</option>
          </select>
          {state.fieldErrors?.businessType && (
            <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.businessType}</p>
          )}
        </div>
      </div>

      {/* 일반 에러 */}
      {state.error && !state.fieldErrors && (
        <div className="rounded-md border border-score-bad/30 bg-score-bad/10 px-3 py-2 text-sm text-score-bad">
          {state.error}
        </div>
      )}
      {state.error && state.fieldErrors && !state.fieldErrors.email && !state.fieldErrors.password && !state.fieldErrors.name && !state.fieldErrors.companyName && !state.fieldErrors.businessType && (
        <div className="rounded-md border border-score-bad/30 bg-score-bad/10 px-3 py-2 text-sm text-score-bad">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? '가입 중...' : '가입하고 바로 시작하기'}
      </button>
    </form>
  );
}
