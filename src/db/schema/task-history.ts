/**
 * task_history — 작업 변경 이력 (Immutable)
 *
 * 출처: docs/DATA_MODEL.md §5.2
 * ADR: ADR-010 (Audit 표는 INSERT/SELECT만 허용, UPDATE/DELETE 금지)
 *
 * 역할: tasks 표의 모든 컬럼 변경 기록.
 * 예: status 'pending' → 'in_progress', assignee 변경, due_at 연기 등.
 *
 * 핵심 제약 (RLS로 강제):
 * - INSERT만 가능
 * - UPDATE 금지
 * - DELETE 금지
 * - 한 번 기록된 이력은 영구 보존 (감사 + 분쟁 대비)
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { tasks } from './tasks';
import { users } from './users';

export const taskHistory = pgTable('task_history', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 멀티테넌트 키
  company_id: uuid('company_id')
    .notNull()
    .references(() => companies.id),

  // 대상 작업
  task_id: uuid('task_id')
    .notNull()
    .references(() => tasks.id),

  // 변경 내용
  field: text('field').notNull(), //                     'status'|'assignee'|'due_at'|...
  old_value: text('old_value'),
  new_value: text('new_value'),

  // 누가 언제
  changed_by: uuid('changed_by').references(() => users.id),
  changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
});

export type TaskHistory = typeof taskHistory.$inferSelect;
export type NewTaskHistory = typeof taskHistory.$inferInsert;
