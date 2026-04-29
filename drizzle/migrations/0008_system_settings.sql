-- ============================================================
-- 0008_system_settings.sql — 전역 시스템 설정 key-value 테이블
-- ============================================================
-- 출처: src/db/schema/system-settings.ts
-- 헌법: CLAUDE.md §1 P-7 (비밀 노출 금지) — 민감값 저장하므로 RLS 강제
--
-- 동기:
--   Vercel 서버리스는 인스턴스 여러 개. globalThis 메모리/파일은 인스턴스별
--   분리되어 /settings 에서 저장한 쿠키가 다른 인스턴스에 안 보임.
--   이 테이블이 인스턴스 간 공유 영구 저장소 역할.
--
-- 사용 사례:
--   key='sellochomes_cookie' — 셀록홈즈 connect.sid 값 (사용자가 갱신)
--
-- 적용:
--   npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0008_system_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS 활성화 — 인증된 사용자만 접근 가능
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 정책: 인증된 사용자(authenticated) 면 전체 read/write 가능
-- (셀록홈즈 쿠키는 회사 격리 X — 모든 사용자가 같은 인프라 공유)
-- 역할별 제한이 필요하면 애플리케이션 레벨에서 추가 (requireCompanyContext 등)
DROP POLICY IF EXISTS "system_settings_authenticated_select" ON system_settings;
CREATE POLICY "system_settings_authenticated_select" ON system_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_settings_authenticated_modify" ON system_settings;
CREATE POLICY "system_settings_authenticated_modify" ON system_settings
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- service_role 은 RLS 우회 (관리 작업용 — 마이그레이션, 시드 등)
GRANT ALL ON system_settings TO service_role;
