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

export interface SaveTokenResult {
  ok: boolean;
  error?: string;
}

/**
 * 전체 쿠키 문자열에서 i_token 값만 추출.
 * 사용자가 DevTools Cookies 섹션의 모든 값을 그대로 붙여넣어도 동작하도록.
 *
 * 예:
 *   "_fbp=fb.1...; i_token=abc123; logged_in=1" → "abc123"
 *   "abc123"                                    → "abc123" (그대로)
 */
function extractItemScoutToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/(?:^|;)\s*i_token=([^;\s]+)/i);
  if (match?.[1]) return match[1];

  // i_token= 이 포함 안 되어있으면 입력값 자체가 토큰이라고 가정
  // 단, '=' 또는 ';' 포함 시 잘못된 입력 → 빈 문자열
  if (trimmed.includes('=') || trimmed.includes(';')) return '';
  return trimmed;
}

/**
 * 아이템스카우트 토큰을 저장하고 유효성을 검증한다.
 * 성공/실패를 state 로 반환 — Next.js 서버 액션 throw 는 production 에서 메시지 마스킹됨.
 */
export async function saveItemScoutTokenAction(form: FormData): Promise<SaveTokenResult> {
  await requireCompanyContext();

  const raw = (form.get('token') as string | null) ?? '';
  const token = extractItemScoutToken(raw);

  if (!token) {
    return {
      ok: false,
      error:
        '토큰을 찾을 수 없습니다. i_token 값(해시 문자열)만 넣거나, 쿠키 전체 문자열을 그대로 붙여넣으세요.',
    };
  }

  // 토큰 유효성 검증 — 간단한 API 호출
  try {
    const res = await fetch(`${BASE_URL}/auth`, {
      headers: { Cookie: `i_token=${token}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `토큰이 유효하지 않습니다 (아이템스카우트 응답 ${res.status}). 최신 i_token 값으로 다시 시도하세요.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `아이템스카우트 연결 실패: ${err instanceof Error ? err.message : '네트워크 오류'}`,
    };
  }

  await saveItemScoutToken(token);

  revalidatePath('/settings');
  revalidatePath('/research');
  return { ok: true };
}

/**
 * 현재 토큰 설정 상태 확인.
 */
export async function checkItemScoutConnection(): Promise<boolean> {
  return hasItemScoutToken();
}
