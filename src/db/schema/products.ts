/**
 * products — 상품 (라이프사이클 + 모든 단계 통합)
 *
 * 출처: docs/DATA_MODEL.md §3.1
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹 강제), §10 (마진은 estimated)
 * ADR: ADR-007 (cogs/margin은 추정값, *_confidence 컬럼 강제)
 *
 * 역할: 5단계 파이프라인(Research → Sourcing → Importing → Listing → Active)을
 * 거치는 상품의 마스터 표. 모든 단계가 이 표를 중심으로 연결된다.
 *
 * 핵심 제약:
 * - 회사 내 상품 코드(code)는 unique
 * - cogs_cny / margin_rate는 항상 *_confidence 컬럼 동반 (P-3)
 * - 추정값(estimated)은 회계 계산에 직접 사용 금지 (CLAUDE.md §10.6)
 */
import {
  decimal,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { keywords } from './keywords';
import { suppliers } from './suppliers';
import { users } from './users';

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 상품 식별
    code: text('code').notNull(), //                       'PROD-2026-0042' (회사 내 unique)
    name: text('name').notNull(),
    category: text('category'), //                         '생활용품', '농산물' 등

    // 파이프라인 단계 (6단계 + research)
    status: text('status').notNull(), //                   'research'|'sourcing'|'importing'|'listing'|'active'

    // ─── 가격 정보 (모두 *_confidence 강제 — P-3) ───
    cogs_cny: decimal('cogs_cny', { precision: 12, scale: 2 }), //         원가 (위안)
    cogs_cny_confidence: text('cogs_cny_confidence').default('unknown'), // ADR-007: 'confirmed'|'estimated'|'unknown'
    cogs_krw: decimal('cogs_krw', { precision: 12, scale: 2 }), //         환율+관세+배송 포함 최종원가
    selling_price_krw: decimal('selling_price_krw', { precision: 12, scale: 2 }),
    margin_rate: decimal('margin_rate', { precision: 5, scale: 4 }), //    0.4178
    margin_rate_confidence: text('margin_rate_confidence').default('unknown'),

    // ─── 소싱 관련 ───
    primary_supplier_id: uuid('primary_supplier_id').references(() => suppliers.id),
    primary_keyword_id: uuid('primary_keyword_id').references(() => keywords.id),

    // 담당자
    owner_user_id: uuid('owner_user_id').references(() => users.id),

    // 메타
    thumbnail_url: text('thumbnail_url'),
    description: text('description'),

    // 시간 + 작성자
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // 회사 내 상품 코드는 unique
    unique('products_company_code_uniq').on(t.company_id, t.code),

    // 상태별 목록 조회
    index('products_status_idx').on(t.company_id, t.status),

    // 내가 담당한 상품
    index('products_owner_idx').on(t.owner_user_id),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
