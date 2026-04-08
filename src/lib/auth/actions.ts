/**
 * 인증/회사 관련 Server Actions
 *
 * 출처: Next.js 15 Server Actions
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트)
 *
 * 역할:
 * - 회사 전환 (DB에 active_company_id 갱신 + 페이지 새로고침)
 * - 로그아웃
 *
 * 보안:
 * - 모든 액션은 현재 세션을 먼저 검증
 * - 회사 전환 시 멤버십 검증 (P-4)
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';

import { signOut } from './auth';
import { requireSession } from './session';
import { isUserMemberOfCompany } from './user';

// ─────────────────────────────────────────────────────────
// 회사 전환
// ─────────────────────────────────────────────────────────

export interface SwitchCompanyResult {
  ok: boolean;
  error?: string;
}

/**
 * 활성 회사 변경.
 *
 * 동작:
 * 1. 세션에서 현재 사용자 ID 가져오기
 * 2. 대상 회사가 사용자의 멤버십에 있는지 검증 (P-4)
 * 3. users.active_company_id를 DB에 저장
 * 4. 모든 페이지 캐시 무효화 + 홈으로 리디렉션
 *
 * 주의: JWT 토큰의 activeCompanyId는 다음 토큰 갱신 시 반영됨.
 * 즉시 반영하려면 NextAuth update() 도 호출해야 하지만, 페이지 리로드로 충분함.
 */
export async function switchCompanyAction(targetCompanyId: string): Promise<SwitchCompanyResult> {
  // 1) 입력 검증
  if (!targetCompanyId || typeof targetCompanyId !== 'string') {
    return { ok: false, error: '회사 ID가 유효하지 않습니다.' };
  }

  // 2) 세션 검증
  const session = await requireSession();

  // 3) 멤버십 검증 (P-4 — 무단 전환 차단)
  const isMember = await isUserMemberOfCompany(session.userId, targetCompanyId);
  if (!isMember) {
    return { ok: false, error: '해당 회사의 멤버가 아닙니다.' };
  }

  // 4) DB 업데이트
  await db
    .update(users)
    .set({ active_company_id: targetCompanyId, updated_at: new Date() })
    .where(eq(users.id, session.userId));

  // 5) 캐시 무효화 + 홈으로
  revalidatePath('/', 'layout');
  redirect('/');
}

// ─────────────────────────────────────────────────────────
// 로그아웃
// ─────────────────────────────────────────────────────────

/**
 * 로그아웃 — 세션 쿠키 삭제 후 /login으로.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
