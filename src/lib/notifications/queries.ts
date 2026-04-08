/**
 * 알림(notifications) 도메인 — 쿼리 + 변경 헬퍼
 *
 * 출처: src/db/schema/notifications.ts, docs/DATA_MODEL.md §5.4
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-1 (빈 결과 은폐 금지)
 *
 * 역할:
 * - 회사 + 사용자별 알림 목록 조회
 * - 단건/전체 읽음 처리
 * - 미읽음 카운트 (헤더 종 모양용)
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS 자동 적용.
 *
 * 알림 분류 (severity):
 * - critical: 빨강 (즉시 조치 필요)
 * - warning: 노랑 (주의)
 * - info: 회색 (정보 제공)
 */
import { and, count, desc, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { notifications, type Notification } from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 상수 + 타입
// ─────────────────────────────────────────────────────────

export const NOTIFICATION_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListNotificationsParams {
  companyId: string;
  userId: string;
  /** true면 미읽음 알림만 */
  unreadOnly?: boolean;
  limit?: number;
}

// ─────────────────────────────────────────────────────────
// 조회 — 목록
// ─────────────────────────────────────────────────────────

/**
 * 사용자의 알림 목록 (최신순).
 */
export async function listNotifications(
  params: ListNotificationsParams,
): Promise<Notification[]> {
  if (!params.companyId || !params.userId) {
    throw new Error('[listNotifications] companyId와 userId가 필요합니다.');
  }
  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [
      eq(notifications.company_id, params.companyId),
      eq(notifications.user_id, params.userId),
    ];
    if (params.unreadOnly === true) {
      conditions.push(eq(notifications.is_read, false));
    }

    const rows = await tx
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.created_at))
      .limit(limit);
    return rows;
  });
}

/**
 * 사용자의 미읽음 알림 수 (헤더 종 배지용).
 */
export async function countUnreadNotifications(
  companyId: string,
  userId: string,
): Promise<number> {
  if (!companyId || !userId) return 0;
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.company_id, companyId),
          eq(notifications.user_id, userId),
          eq(notifications.is_read, false),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 읽음 처리
// ─────────────────────────────────────────────────────────

export interface MarkAsReadInput {
  companyId: string;
  userId: string;
  notificationId: string;
}

/**
 * 단건 읽음 처리.
 * 본인 알림이 아니면 RLS + user_id 조건으로 0건 업데이트되어 안전.
 */
export async function markNotificationAsRead(input: MarkAsReadInput): Promise<void> {
  if (!input.companyId || !input.userId || !input.notificationId) {
    throw new Error('[markNotificationAsRead] companyId, userId, notificationId가 필요합니다.');
  }

  await withCompanyContext(input.companyId, async (tx) => {
    await tx
      .update(notifications)
      .set({ is_read: true, read_at: new Date() })
      .where(
        and(
          eq(notifications.id, input.notificationId),
          eq(notifications.user_id, input.userId),
        ),
      );
  });
}

/**
 * 사용자의 모든 미읽음 알림을 한 번에 읽음 처리.
 */
export async function markAllNotificationsAsRead(
  companyId: string,
  userId: string,
): Promise<void> {
  if (!companyId || !userId) {
    throw new Error('[markAllNotificationsAsRead] companyId와 userId가 필요합니다.');
  }

  await withCompanyContext(companyId, async (tx) => {
    await tx
      .update(notifications)
      .set({ is_read: true, read_at: new Date() })
      .where(
        and(
          eq(notifications.company_id, companyId),
          eq(notifications.user_id, userId),
          eq(notifications.is_read, false),
        ),
      );
  });
}
