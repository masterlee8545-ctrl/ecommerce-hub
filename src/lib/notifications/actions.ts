/**
 * 알림(notifications) Server Actions
 *
 * 출처: src/lib/notifications/queries.ts (D-3b)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 알림 단건 읽음 처리
 * - 모두 읽음 처리
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - userId는 세션에서 추출 (사용자가 다른 사람 알림 못 만짐)
 */
'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanyContext } from '@/lib/auth/session';

import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from './queries';

// ─────────────────────────────────────────────────────────
// 폼 파싱 헬퍼
// ─────────────────────────────────────────────────────────

function getStringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

// ─────────────────────────────────────────────────────────
// 액션 — 단건 읽음
// ─────────────────────────────────────────────────────────

/**
 * 알림 단건 읽음 처리 (목록의 개별 버튼용).
 */
export async function markNotificationAsReadAction(form: FormData): Promise<void> {
  const notificationId = getStringField(form, 'notificationId').trim();
  if (!notificationId) {
    throw new Error('알림 ID가 없습니다.');
  }

  const ctx = await requireCompanyContext();

  try {
    await markNotificationAsRead({
      companyId: ctx.companyId,
      userId: ctx.userId,
      notificationId,
    });
  } catch (err) {
    console.error('[markNotificationAsReadAction] DB 변경 실패:', err);
    throw new Error(
      err instanceof Error
        ? `읽음 처리 중 오류: ${err.message}`
        : '읽음 처리 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/notifications');
  revalidatePath('/');
}

// ─────────────────────────────────────────────────────────
// 액션 — 모두 읽음
// ─────────────────────────────────────────────────────────

/**
 * 사용자의 모든 미읽음 알림을 한 번에 읽음 처리.
 */
export async function markAllNotificationsAsReadAction(): Promise<void> {
  const ctx = await requireCompanyContext();

  try {
    await markAllNotificationsAsRead(ctx.companyId, ctx.userId);
  } catch (err) {
    console.error('[markAllNotificationsAsReadAction] DB 변경 실패:', err);
    throw new Error(
      err instanceof Error
        ? `모두 읽음 처리 중 오류: ${err.message}`
        : '모두 읽음 처리 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/notifications');
  revalidatePath('/');
}
