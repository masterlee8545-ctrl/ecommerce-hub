/**
 * 알림 쿼리 헬퍼 단위 테스트
 *
 * 출처: src/lib/notifications/queries.ts (D-3b)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트)
 *
 * 검증 항목:
 * 1. NOTIFICATION_SEVERITIES 상수 무결성
 * 2. listNotifications — 입력 검증
 * 3. countUnreadNotifications — 부분 입력 시 0
 * 4. markNotificationAsRead / markAllNotificationsAsRead — 입력 검증
 *
 * 주의: 실제 DB는 호출하지 않는다.
 */
import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_SEVERITIES,
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from './queries';

// ─────────────────────────────────────────────────────────
// 1. 상수 무결성
// ─────────────────────────────────────────────────────────

describe('NOTIFICATION_SEVERITIES — 상수 무결성', () => {
  it('3종 정의됨', () => {
    const EXPECTED_COUNT = 3;
    expect(NOTIFICATION_SEVERITIES).toHaveLength(EXPECTED_COUNT);
  });

  it('critical, warning, info 모두 포함', () => {
    expect(NOTIFICATION_SEVERITIES).toContain('critical');
    expect(NOTIFICATION_SEVERITIES).toContain('warning');
    expect(NOTIFICATION_SEVERITIES).toContain('info');
  });
});

// ─────────────────────────────────────────────────────────
// 2. listNotifications — 입력 검증
// ─────────────────────────────────────────────────────────

describe('listNotifications — 입력 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      listNotifications({ companyId: '', userId: 'some-user' }),
    ).rejects.toThrow('companyId');
  });

  it('userId 누락 시 throw', async () => {
    await expect(
      listNotifications({ companyId: 'some-company', userId: '' }),
    ).rejects.toThrow('userId');
  });
});

// ─────────────────────────────────────────────────────────
// 3. countUnreadNotifications — 부분 입력 시 0 반환
// ─────────────────────────────────────────────────────────

describe('countUnreadNotifications — 안전한 폴백', () => {
  it('companyId 누락 시 0 반환 (throw 안 함)', async () => {
    const result = await countUnreadNotifications('', 'some-user');
    expect(result).toBe(0);
  });

  it('userId 누락 시 0 반환', async () => {
    const result = await countUnreadNotifications('some-company', '');
    expect(result).toBe(0);
  });

  it('둘 다 누락 시 0 반환', async () => {
    const result = await countUnreadNotifications('', '');
    expect(result).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// 4. markNotificationAsRead — 입력 검증
// ─────────────────────────────────────────────────────────

describe('markNotificationAsRead — 입력 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      markNotificationAsRead({
        companyId: '',
        userId: 'some-user',
        notificationId: 'some-notif',
      }),
    ).rejects.toThrow();
  });

  it('userId 누락 시 throw', async () => {
    await expect(
      markNotificationAsRead({
        companyId: 'some-company',
        userId: '',
        notificationId: 'some-notif',
      }),
    ).rejects.toThrow();
  });

  it('notificationId 누락 시 throw', async () => {
    await expect(
      markNotificationAsRead({
        companyId: 'some-company',
        userId: 'some-user',
        notificationId: '',
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────
// 5. markAllNotificationsAsRead — 입력 검증
// ─────────────────────────────────────────────────────────

describe('markAllNotificationsAsRead — 입력 검증', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(markAllNotificationsAsRead('', 'some-user')).rejects.toThrow('companyId');
  });

  it('userId 누락 시 throw', async () => {
    await expect(markAllNotificationsAsRead('some-company', '')).rejects.toThrow('userId');
  });
});
