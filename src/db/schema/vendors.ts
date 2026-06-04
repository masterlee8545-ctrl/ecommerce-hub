/**
 * vendors — 국내 농가/공장 마스터 (ADR-012)
 *
 * 출처: docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.9
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹), §1 P-4/P-5 (멀티테넌트), §1 P-7 (RLS)
 * ADR: ADR-012 (suppliers 와 분리), ADR-013 (공유 승인제 - 4번 PR에서 RLS 교체)
 *
 * 역할:
 *   국내 농가/공장 (사이소·김제몰류) 마스터. suppliers (1688) 와 분리.
 *
 * 1번 PR 범위: 회사 격리 RLS. 4번 PR 에서 공유 SELECT (vendor_access_grants) 추가.
 */
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키 (P-5)
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // ─── 식별 ───
    slug: text('slug').notNull(), //                       사이소 sellerId / jpsmall slug
    biz_name: text('biz_name').notNull(), //               업체명
    biz_no: text('biz_no'), //                             사업자번호 (정규화, 10자리)
    biz_no_confidence: text('biz_no_confidence').notNull().default('estimated'), // P-3

    // ─── 대표 ───
    biz_owner_name: text('biz_owner_name'),
    repr_tel_no: text('repr_tel_no'),
    biz_mobile: text('biz_mobile'),
    contact_confidence: text('contact_confidence').notNull().default('estimated'),

    // ─── 주소 ───
    biz_address: text('biz_address'),
    biz_zip: text('biz_zip'),

    // ─── 업종 (사이소 데이터) ───
    biz_type: text('biz_type'), //                         '제조' | '유통' | '사업자'
    biz_sector: text('biz_sector'), //                     업종 텍스트

    // ─── 분류 ───
    classification: text('classification'), //             '1차_농가' | '가공유통' | ...
    classification_basis: text('classification_basis'),

    // ─── 상품 정보 요약 ───
    product_count: integer('product_count').default(0),
    product_keywords_all: text('product_keywords_all'),
    products_top10: text('products_top10'),

    // ─── 출처 추적 ───
    source_site: text('source_site').notNull(), //         '사이소-안동장터' 등
    also_listed_on: text('also_listed_on')
      .array()
      .notNull()
      .default([]), //                                      ['사이소-경주몰', ...]
    source_url: text('source_url'),

    // ─── 개인정보 (사이소만, ADR-013 D-4 — 4번 PR 에서 마스킹 view) ───
    rpers_birthdt: date('rpers_birthdt'),
    rpers_gender: text('rpers_gender'),

    // ─── 소개 ───
    intro_html: text('intro_html'),

    // ─── 영업 상태 (회사별 격리) ───
    /** active | no_phone | no_answer | sourcing_failed | dropped | contracted */
    work_status: text('work_status').default('active'),
    /** 상태 메모 (예: "전화 안 받음 5/18 17시", "단가 너무 높음") */
    status_note: text('status_note'),
    status_updated_at: timestamp('status_updated_at', { withTimezone: true }),

    // ─── 공통 ───
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    created_by: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // 회사 안에서 slug 는 unique (같은 사이소 sellerId 가 한 회사에 두 row 안 됨)
    unique('vendors_company_slug_unique').on(t.company_id, t.slug),

    // 회사별 목록 조회
    index('idx_vendors_company').on(t.company_id),

    // 사업자번호 dedup 매칭
    index('idx_vendors_biz_no').on(t.biz_no),

    // 출처 / 분류 필터
    index('idx_vendors_source_site').on(t.source_site),
    index('idx_vendors_classification').on(t.classification),
  ],
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
