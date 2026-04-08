/**
 * users — 사용자
 *
 * 출처: docs/DATA_MODEL.md §2.2
 * 헌법: CLAUDE.md §1 P-7 (비밀번호 해시 강제)
 *
 * 역할: 시스템 사용자. user_companies를 통해 여러 회사에 소속될 수 있음.
 *
 * 보안:
 * - password_hash는 bcrypt cost ≥ 12 (NextAuth v5 인증 흐름에서 검증)
 * - password 평문 컬럼 절대 금지 (P-7)
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 인증 핵심
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  password_hash: text('password_hash').notNull(), //        bcrypt cost ≥ 12

  // 프로필
  avatar_url: text('avatar_url'),

  // 마지막 활성 회사 (멀티테넌트 컨텍스트 복원용)
  active_company_id: uuid('active_company_id'),

  // 활성/비활성 (탈퇴 처리)
  is_active: boolean('is_active').notNull().default(true),

  // 시간
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
