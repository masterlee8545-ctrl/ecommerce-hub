/**
 * vendor_access_grants — 농가 풀 공유 승인 (ADR-013)
 *
 * 출처: docs/ADR-013.md, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.13
 * 헌법: CLAUDE.md §1 P-5/P-7
 * ADR: ADR-013
 *
 * 역할:
 *   강의생 확장 비전 (CPS Phase 3) 을 위해 형의 농가 풀을 승인 받은 강의생에게 공유.
 *
 * 1번 PR 범위: 스키마만. 본격 운영 (vendors.SELECT 정책 교체 + UI) 은 4번 PR.
 */
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const vendorAccessGrants = pgTable(
  'vendor_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    grantor_company_id: uuid('grantor_company_id')
      .notNull()
      .references(() => companies.id), //                풀 소유자
    grantee_company_id: uuid('grantee_company_id')
      .notNull()
      .references(() => companies.id), //                신청자

    status: text('status').notNull().default('pending'),
    //                                                  'pending' | 'approved' | 'rejected' | 'revoked'

    requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    decided_at: timestamp('decided_at', { withTimezone: true }),
    decided_by_user_id: uuid('decided_by_user_id').references(() => users.id),

    reason: text('reason'), //                          신청 사유
    notes: text('notes'), //                            결정 메모
  },
  (t) => [
    unique('vag_unique_pair').on(t.grantor_company_id, t.grantee_company_id),

    index('idx_vag_grantor').on(t.grantor_company_id),
    index('idx_vag_grantee').on(t.grantee_company_id),
    index('idx_vag_status').on(t.status),
  ],
);

export type VendorAccessGrant = typeof vendorAccessGrants.$inferSelect;
export type NewVendorAccessGrant = typeof vendorAccessGrants.$inferInsert;
