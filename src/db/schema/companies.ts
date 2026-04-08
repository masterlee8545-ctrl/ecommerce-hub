/**
 * companies — 회사 (멀티테넌트 루트)
 *
 * 출처: docs/DATA_MODEL.md §2.1
 * 헌법: CLAUDE.md §1 P-5 (멀티테넌트), §10 신뢰도 마킹
 *
 * 역할: 모든 비즈니스 데이터의 소속 회사. 모든 다른 표가 company_id로 이 표를 참조.
 *
 * 시드 데이터 (다음 단계 마이그레이션에서 INSERT):
 * - 바이와이즈 (주) — industrial
 * - 유어밸류 (주) — agricultural
 * - 유어옵티멀 (주) — other
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 회사 기본 정보
  name: text('name').notNull(), //                          예: "바이와이즈 (주)"
  business_type: text('business_type').notNull(), //        'industrial' | 'agricultural' | 'other'
  registration_no: text('registration_no'), //              사업자등록번호 (선택)
  representative: text('representative'), //                대표자명
  address: text('address'),
  phone: text('phone'),

  // 외부 시스템 매핑
  bw_rank_company_id: text('bw_rank_company_id'), //        BW Rank 시스템 매핑 (ADR-006)

  // 기본 통화
  default_currency: text('default_currency').notNull().default('KRW'),

  // 시간
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
