-- ============================================================
-- 0007_mcp_tokens.sql — Claude.ai MCP 인증용 토큰 테이블 (Phase B)
-- ============================================================
-- 출처: src/db/schema/mcp-tokens.ts
-- 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-7 (평문 저장 금지)
--
-- 특이점:
-- - 이 테이블은 RLS 강제 적용되지 않는다. 인증 "이전" 에 조회되기 때문.
-- - 대신 조회 시 항상 token_hash 로 매칭 → revoked_at IS NULL 체크
-- - company_id 격리는 토큰에 심긴 값으로 애플리케이션 레벨에서 제어
--
-- 적용: npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0007_mcp_tokens
-- ============================================================

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  label text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_tokens_hash_idx ON mcp_tokens (token_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_id);

COMMENT ON TABLE mcp_tokens IS
  'MCP (Claude.ai 웹앱) 개인 액세스 토큰. 평문 저장 금지 — sha256 해시만.';
