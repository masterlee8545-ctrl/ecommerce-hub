/**
 * notifications — 알림
 *
 * 출처: docs/DATA_MODEL.md §5.4
 *
 * 역할: 사용자에게 전달할 알림 메시지.
 * 예: "작업 X가 당신에게 할당되었습니다", "캠페인 Y의 ROAS가 임계치 미달", "키워드 순위가 5단계 하락"
 *
 * 알림 발생 흐름:
 * 1. 시스템 이벤트 발생 (task 할당 / ROAS 알림 / 순위 변동 등)
 * 2. notifications 표에 INSERT
 * 3. 사용자가 헤더 종 모양 클릭 → is_read=false인 알림 목록 조회
 * 4. 알림 클릭 → link_url로 이동 → is_read=true 갱신
 *
 * 핵심 인덱스: (user_id, is_read) — 미읽음 알림 빠른 조회
 */
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { tasks } from './tasks';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 수신자
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),

    // 알림 분류
    type: text('type').notNull(), //                        'task_assigned'|'roas_alert'|'rank_drop'|...
    severity: text('severity').notNull().default('info'), // 'critical'|'warning'|'info'

    // 알림 내용
    title: text('title').notNull(),
    body: text('body'),
    link_url: text('link_url'), //                          클릭 시 이동할 내부 경로

    // 읽음 처리
    is_read: boolean('is_read').notNull().default(false),
    read_at: timestamp('read_at', { withTimezone: true }),

    // 관련 엔티티 (선택)
    related_task_id: uuid('related_task_id').references(() => tasks.id),
    related_product_id: uuid('related_product_id').references(() => products.id),

    // 시간
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 미읽음 알림 빠른 조회 (헤더 종 모양 클릭 시)
    index('notif_user_unread_idx').on(t.user_id, t.is_read),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
