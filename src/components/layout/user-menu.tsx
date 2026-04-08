/**
 * 사용자 메뉴 — 클라이언트 컴포넌트
 *
 * 출처: 헤더 우측 사용자 아이콘 + 드롭다운
 *
 * 역할:
 * - 사용자 이름·이메일 표시
 * - 로그아웃 버튼
 *
 * 디자인:
 * - 이니셜 동그라미
 * - 클릭 시 details 펼침
 */
'use client';

import { useTransition } from 'react';

import { LogOut, User } from 'lucide-react';

import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

interface UserMenuProps {
  name: string;
  email: string;
}

export function UserMenu({ name, email }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();

  // 이름 첫 글자 (없으면 이메일 첫 글자)
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();

  function handleSignOut() {
    if (isPending) return;
    startTransition(async () => {
      await signOutAction();
    });
  }

  return (
    <details className="relative">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-full transition hover:opacity-80',
          isPending && 'opacity-60',
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">
          {initial}
        </div>
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-navy-200 bg-white shadow-lg">
        {/* 사용자 정보 */}
        <div className="border-b border-navy-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-base font-semibold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-navy-900">
                {name || '이름 없음'}
              </div>
              <div className="truncate text-xs text-navy-500">{email}</div>
            </div>
          </div>
        </div>

        {/* 액션 */}
        <ul className="py-1">
          <li>
            <a
              href="/settings/profile"
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
            >
              <User className="h-4 w-4" aria-hidden />
              내 프로필
            </a>
          </li>
          <li>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isPending}
              className={cn(
                'flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-navy-700 transition hover:bg-navy-50',
                isPending && 'cursor-wait opacity-60',
              )}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {isPending ? '로그아웃 중...' : '로그아웃'}
            </button>
          </li>
        </ul>
      </div>
    </details>
  );
}
