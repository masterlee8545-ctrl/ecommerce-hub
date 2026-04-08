/**
 * tasks — 작업 (사람이 해야 할 일)
 *
 * 출처: docs/DATA_MODEL.md §5.1
 * SPEC: §7 (15종 task_type 정의)
 * ADR: ADR-005 (Idempotency Key — 자동 생성 작업의 중복 방지)
 *
 * 역할: 시스템 전체의 To-Do 리스트. 사람이 해야 할 모든 일이 여기 모인다.
 *
 * 자동 생성 흐름:
 * 1. 상품 status가 sourcing → importing으로 바뀜
 * 2. 트랜지션 트리거가 자동으로 "발주서 작성" 작업 생성
 * 3. idempotency_key로 같은 트랜지션의 중복 작업 생성 방지
 *
 * 핵심 제약:
 * - idempotency_key UNIQUE (ADR-005 — 자동 생성 중복 방지의 핵심)
 * - status: 'pending'|'in_progress'|'review'|'done'|'cancelled'
 * - priority: 'urgent'|'high'|'normal'|'low'
 */
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { products } from './products';
import { users } from './users';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 연결 (상품과 무관한 일반 작업도 가능 — nullable)
    product_id: uuid('product_id').references(() => products.id),

    // 작업 분류
    task_type: text('task_type').notNull(), //              SPEC §7의 15종 중 하나
    title: text('title').notNull(),
    description: text('description'),

    // 상태
    status: text('status').notNull().default('pending'), // 'pending'|'in_progress'|'review'|'done'|'cancelled'
    priority: text('priority').notNull().default('normal'), // 'urgent'|'high'|'normal'|'low'

    // 담당자 + 일정
    assignee_id: uuid('assignee_id').references(() => users.id),
    due_at: timestamp('due_at', { withTimezone: true }),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),

    // 멱등성 키 (ADR-005) — 자동 생성 중복 방지의 핵심
    idempotency_key: text('idempotency_key'), //            'transition:{product_id}:{from}:{to}:{task_type}'

    // 메타 (작업별 추가 정보 — 자유 형식)
    metadata: jsonb('metadata'),

    // 시간 + 작성자
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
    source: text('source').notNull().default('auto'), //   'auto'|'manual'
  },
  (t) => [
    // 내 작업 조회 (담당자 + 상태)
    index('tasks_assignee_status_idx').on(t.assignee_id, t.status),

    // 상품별 작업 목록
    index('tasks_product_idx').on(t.product_id),

    // 마감 임박 조회
    index('tasks_due_idx').on(t.due_at),

    // ADR-005: 자동 생성 중복 방지
    unique('tasks_idempotency_key_uniq').on(t.idempotency_key),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
