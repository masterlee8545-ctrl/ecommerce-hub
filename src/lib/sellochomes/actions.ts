/**
 * 셀록홈즈 설정 Server Actions
 *
 * 역할:
 * - 쿠키 저장/검증
 * - 사용자가 DevTools 에서 복사한 어떤 형태든 connect.sid 값 추출
 *
 * 검증 방법: 셀록홈즈 sellerlife 카테고리 bootstrap API 를 새 쿠키로 호출.
 * 401/403 또는 비정상 응답이면 거절. 통과하면 메모리+파일에 저장.
 */
'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanyContext } from '@/lib/auth/session';

import { saveSellochomesCookie, hasSellochomesCookie } from './client';

const VALIDATE_URL =
  'https://sellochomes.co.kr/api/v1/sellerlife/sourcing/include/moveCategoryPage?wholeCategoryName=식품';

export interface SaveCookieResult {
  ok: boolean;
  error?: string;
}

/**
 * 사용자가 붙여넣은 입력에서 connect.sid 값을 추출.
 * 허용 입력 형태:
 *   1. 값만:      "s%3Aabc...XYZ"
 *   2. 키=값:    "connect.sid=s%3A..."
 *   3. 전체 쿠키: "_ga=...; sourcinglife_visitor_id=...; connect.sid=s%3A...; _ga_JB..."
 */
function extractSellochomesCookie(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // 패턴: connect.sid=값 (앞에 다른 쿠키 있을 수도 있음)
  const match = trimmed.match(/(?:^|;)\s*connect\.sid=([^;\s]+)/i);
  if (match?.[1]) return match[1];

  // connect.sid 없으면 입력값 자체가 값이라고 가정
  // 단, '=' 또는 ';' 포함 시 잘못된 입력 → 빈 문자열
  if (trimmed.includes('=') || trimmed.includes(';')) return '';
  return trimmed;
}

/**
 * 셀록홈즈 쿠키를 저장하고 유효성을 검증한다.
 * 성공/실패를 state 로 반환 — Next.js 서버 액션 throw 는 production 에서 메시지 마스킹됨.
 */
export async function saveSellochomesCookieAction(
  form: FormData,
): Promise<SaveCookieResult> {
  await requireCompanyContext();

  const raw = (form.get('cookie') as string | null) ?? '';
  const cookie = extractSellochomesCookie(raw);

  if (!cookie) {
    return {
      ok: false,
      error:
        '쿠키를 찾을 수 없습니다. connect.sid 값(s%3A로 시작하는 문자열)만 넣거나, 쿠키 전체 문자열을 그대로 붙여넣으세요.',
    };
  }

  // 쿠키 유효성 검증 — bootstrap 카테고리("식품") 호출
  try {
    const res = await fetch(VALIDATE_URL, {
      headers: {
        Cookie: `connect.sid=${cookie}`,
        Accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        Referer: 'https://sellochomes.co.kr/sellerlife/sourcing/category/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: `쿠키가 유효하지 않습니다 (셀록홈즈 응답 ${res.status}). 셀록홈즈에 다시 로그인 후 새 쿠키 값으로 시도하세요.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `셀록홈즈 응답 실패 (HTTP ${res.status}). 잠시 후 다시 시도하세요.`,
      };
    }

    const body = (await res.json()) as { _result?: number; _desc?: string };
    if (body._result !== 1) {
      return {
        ok: false,
        error: `쿠키 검증 실패: ${body._desc || '응답이 비정상입니다.'} 셀록홈즈에서 새 쿠키를 복사해 다시 시도하세요.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `셀록홈즈 연결 실패: ${err instanceof Error ? err.message : '네트워크 오류'}`,
    };
  }

  await saveSellochomesCookie(cookie);

  revalidatePath('/settings');
  revalidatePath('/research');
  return { ok: true };
}

/** 현재 쿠키 설정 상태 확인. */
export async function checkSellochomesConnection(): Promise<boolean> {
  return hasSellochomesCookie();
}
