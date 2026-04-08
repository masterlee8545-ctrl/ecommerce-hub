/**
 * user_companies — 사용자-회사 다대다 (권한 등급)
 *
 * 출처: docs/DATA_MODEL.md §2.3
 * 헌법: CLAUDE.md §1 P-5 (멀티테넌트의 근거 표 — RLS 미적용)
 *
 * 역할: 어떤 사용자가 어떤 회사에 어떤 권한으로 소속되어 있는지.
 * 다른 모든 표의 RLS 정책은 이 표를 참조하여 회사 접근 권한을 판단한다.
 *
 * 권한 등급:
 * - owner: 모든 권한 (회사 설정 변경 포함)
 * - manager: 비즈니스 데이터 CRUD + 작업 할당
 * - operator: 본인 작업만 처리, 일부 데이터 read-only
 *
 * 주의:
 * - 이 표 자체에는 RLS 미적용 (RLS의 근거가 되는 표이므로)
 * - 한 사용자가 같은 회사에 중복 소속 금지 (UNIQUE 제약)
 */
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const userCompanies = pgTable(
  'user_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),

    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    role: text('role').notNull(), //                       'owner' | 'manager' | 'operator'

    joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 한 사용자는 같은 회사에 한 번만 소속
    unique('uc_user_company_uniq').on(t.user_id, t.company_id),

    // 빠른 조회 인덱스
    index('uc_user_idx').on(t.user_id),
    index('uc_company_idx').on(t.company_id),
  ],
);

export type UserCompany = typeof userCompanies.$inferSelect;
export type NewUserCompany = typeof userCompanies.$inferInsert;
