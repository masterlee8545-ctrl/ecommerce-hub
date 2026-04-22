/**
 * MCP 토큰 인증 — /api/mcp 의 모든 요청이 통과해야 하는 게이트.
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-7 (평문 저장 금지)
 *
 * 흐름:
 * 1. 클라이언트(Claude.ai) 가 `Authorization: Bearer mcp_<랜덤>` 헤더 전송
 * 2. sha256 해시 계산 → mcp_tokens 테이블 조회
 * 3. revoked_at IS NULL + expires_at 확인
 * 4. last_used_at 갱신
 * 5. user_id + company_id 반환 → 요청자의 컨텍스트 결정
 */
import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { mcpTokens, type McpToken } from '@/db/schema';

export interface AuthenticatedMcpToken {
  tokenId: string;
  userId: string;
  companyId: string;
  label: string;
}

const TOKEN_PREFIX = 'mcp_';
const TOKEN_BYTE_LEN = 32;
const TOKEN_PREFIX_DISPLAY_LEN = 12;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * 새 토큰 발급 — 평문은 한 번만 반환, DB 에는 해시만 저장.
 */
export async function issueMcpToken(input: {
  userId: string;
  companyId: string;
  label: string;
  expiresInDays?: number;
}): Promise<{ token: McpToken; plainToken: string }> {
  const random = randomBytes(TOKEN_BYTE_LEN).toString('base64url');
  const plainToken = `${TOKEN_PREFIX}${random}`;
  const tokenHash = hashToken(plainToken);
  const tokenPrefix = plainToken.slice(0, TOKEN_PREFIX_DISPLAY_LEN);

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * MS_PER_DAY)
    : null;

  const inserted = await db
    .insert(mcpTokens)
    .values({
      user_id: input.userId,
      company_id: input.companyId,
      label: input.label,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      expires_at: expiresAt,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error('[issueMcpToken] INSERT 실패');
  return { token: row, plainToken };
}

/**
 * 토큰 검증 — Authorization 헤더 값에서 토큰 추출 + 해시 조회.
 * 실패 시 null 반환 (401 처리는 caller).
 */
export async function verifyMcpToken(authHeader: string | null): Promise<AuthenticatedMcpToken | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(mcp_[A-Za-z0-9_-]+)$/.exec(authHeader.trim());
  if (!match || !match[1]) return null;

  const plainToken = match[1];
  const tokenHash = hashToken(plainToken);

  const now = new Date();
  const rows = await db
    .select()
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.token_hash, tokenHash),
        isNull(mcpTokens.revoked_at),
        or(isNull(mcpTokens.expires_at), gt(mcpTokens.expires_at, now)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // last_used_at 비동기 갱신 (fire-and-forget)
  db.update(mcpTokens)
    .set({ last_used_at: now })
    .where(eq(mcpTokens.id, row.id))
    .catch((err: unknown) => console.error('[verifyMcpToken] last_used_at 갱신 실패:', err));

  return {
    tokenId: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    label: row.label,
  };
}

/** 토큰 취소 (revoked_at 세팅) */
export async function revokeMcpToken(tokenId: string, userId: string): Promise<void> {
  await db
    .update(mcpTokens)
    .set({ revoked_at: new Date() })
    .where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.user_id, userId)));
}

/** 사용자 토큰 목록 (관리 UI 용) */
export async function listMcpTokensForUser(userId: string): Promise<McpToken[]> {
  return db
    .select()
    .from(mcpTokens)
    .where(eq(mcpTokens.user_id, userId))
    .orderBy(sql`${mcpTokens.created_at} DESC`);
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
