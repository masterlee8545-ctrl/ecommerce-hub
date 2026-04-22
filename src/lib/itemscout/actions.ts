/**
 * 아이템 스카우트 설정 Server Actions
 *
 * 역할:
 * - 토큰 저장/삭제
 * - 토큰 유효성 검증 (API 호출 테스트)
 */
'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanyContext } from '@/lib/auth/session';

import { saveItemScoutToken, hasItemScoutToken } from './client';

const BASE_URL = 'https://api.itemscout.io/api';

/**
 * 아이템스카우트 토큰을 저장하고 유효성을 검증한다.
 * 설정 페이지의 폼에서 호출.
 */
export async function saveItemScoutTokenAction(form: FormData): Promise<void> {
  await requireCompanyContext(); // 인증 확인

  const token = (form.get('token') as string | null)?.trim();
  if (!token || token.length === 0) {
    throw new Error('토큰을 입력해주세요.');
  }

  // 토큰 유효성 검증 — 간단한 API 호출 테스트
  try {
    const res = await fetch(`${BASE_URL}/auth`, {
      headers: { Cookie: `i_token=${token}` },
    });
    if (!res.ok) {
      throw new Error(`API 응답 ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `토큰이 유효하지 않습니다. 아이템스카우트에 로그인 후 다시 시도하세요. (${err instanceof Error ? err.message : '연결 실패'})`,
    );
  }

  await saveItemScoutToken(token);

  revalidatePath('/settings');
  revalidatePath('/research');
}

/**
 * 현재 토큰 설정 상태 확인.
 */
export async function checkItemScoutConnection(): Promise<boolean> {
  return hasItemScoutToken();
}
