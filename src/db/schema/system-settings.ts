/**
 * system_settings — 전역 시스템 설정 key-value 테이블.
 *
 * 헌법: CLAUDE.md §1 P-7 (비밀 노출 금지) — 민감값(예: 셀록홈즈 쿠키)도 저장하므로
 *       반드시 인증된 사용자만 접근 가능하도록 RLS 적용.
 *
 * 역할:
 * - Vercel 서버리스 환경에서 인스턴스 간 공유 가능한 영구 저장소
 * - globalThis 메모리 / 파일은 인스턴스별로 분리되어 일관성 없음 (이 테이블이 해결)
 *
 * 현재 사용:
 * - 'sellochomes_cookie' — /settings 에서 입력한 쿠키 (사용자가 갱신 시 즉시 반영)
 *
 * 설계:
 * - 단일 글로벌 (회사 격리 없음). 셀록홈즈 계정은 1개 공유 인프라.
 * - 회사별 격리가 필요해지면 (key, company_id) 복합 키로 마이그레이션.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
