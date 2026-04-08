/**
 * 로그인 폼 — 클라이언트 컴포넌트
 *
 * 출처: React 19 useActionState + Server Action 패턴
 *
 * 역할:
 * - 이메일/비밀번호 입력
 * - useActionState로 서버 액션 호출 + 결과 표시
 * - 로딩/에러 상태 인라인 표시
 */
'use client';

import { useActionState } from 'react';

import { loginAction, type LoginActionState } from './actions';

const initialState: LoginActionState = { ok: false };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
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
          className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
          placeholder="you@buywise.co"
        />
        {state.fieldErrors?.email && (
          <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.email}</p>
        )}
      </div>

      {/* 비밀번호 */}
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-navy-900">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          disabled={isPending}
          className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-navy-100"
          placeholder="••••••••"
        />
        {state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-score-bad">{state.fieldErrors.password}</p>
        )}
      </div>

      {/* 일반 에러 */}
      {state.error && !state.fieldErrors && (
        <div className="rounded-md border border-score-bad/30 bg-score-bad/10 px-3 py-2 text-sm text-score-bad">
          {state.error}
        </div>
      )}

      {/* 제출 버튼 */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}
