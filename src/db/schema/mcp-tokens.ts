/**
 * mcp_tokens — MCP 서버 인증용 개인 API 토큰.
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-7 (비밀번호·토큰 평문 저장 금지)
 *
 * 역할:
 * - Claude.ai 웹앱이 /api/mcp 에 접근할 때 `Authorization: Bearer <token>` 로 인증
 * - 토큰은 생성 시 한 번만 평문 반환, DB 에는 sha256 해시로 저장
 * - 사용자가 여러 토큰 가질 수 있음 (기기별·프로젝트별)
 * - 토큰 소속: user_id + active_company_id (토큰 사용 시 자동으로 해당 회사 컨텍스트)
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 토큰 소유자
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),

    // 이 토큰이 사용할 활성 법인 (토큰 호출 시 자동으로 이 컨텍스트)
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // 사용자 친화 라벨 (예: "Claude.ai - Home laptop")
    label: text('label').notNull(),

    // sha256(token) — 평문 저장 금지
    token_hash: text('token_hash').notNull(),

    // 선두 prefix (예: "mcp_abc1...") — UI 에서 "이 토큰이 맞나" 확인용
    token_prefix: text('token_prefix').notNull(),

    // 마지막 사용 시각 (토큰 관리 UI 용)
    last_used_at: timestamp('last_used_at', { withTimezone: true }),

    // 발급 / 만료 (만료 없으면 null)
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    /** 취소 시각 (revoked 된 토큰은 사용 불가) */
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('mcp_tokens_hash_idx').on(t.token_hash),
    index('mcp_tokens_user_idx').on(t.user_id),
  ],
);

export type McpToken = typeof mcpTokens.$inferSelect;
export type NewMcpToken = typeof mcpTokens.$inferInsert;
