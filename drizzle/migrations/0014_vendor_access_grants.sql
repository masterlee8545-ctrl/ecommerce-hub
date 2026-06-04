-- ============================================================
-- 0014_vendor_access_grants.sql — 농가 풀 공유 승인 (ADR-013)
-- ============================================================
-- 출처: src/db/schema/vendor-access-grants.ts, docs/ADR-013.md
-- 헌법: CLAUDE.md §1 P-5/P-7
-- ADR: ADR-013
--
-- 동기:
--   강의생 확장 비전 (CPS Phase 3) 을 위해 형의 농가 풀을 승인 받은 강의생에게 공유.
--
-- 1번 PR 범위:
--   - 테이블 + 인덱스만 생성
--   - 본 RLS 정책은 양쪽 회사 (grantor / grantee) 가 자기와 관련된 row 만 조회 가능
--   - 본격 운영 (vendors.SELECT 정책 교체 + 컬럼 마스킹 view + UI) 은 4번 PR
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  grantor_company_id uuid NOT NULL REFERENCES companies(id),  -- 풀 소유자
  grantee_company_id uuid NOT NULL REFERENCES companies(id),  -- 신청자

  status text NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected' | 'revoked'

  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES users(id),

  reason text,         -- 신청 사유 (강의생 → 형)
  notes text,          -- 결정 메모 (형의 승인/거절 사유)

  CONSTRAINT vag_unique_pair UNIQUE (grantor_company_id, grantee_company_id),
  CONSTRAINT vag_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  CONSTRAINT vag_no_self CHECK (grantor_company_id != grantee_company_id)
);

CREATE INDEX IF NOT EXISTS idx_vag_grantor ON vendor_access_grants(grantor_company_id);
CREATE INDEX IF NOT EXISTS idx_vag_grantee ON vendor_access_grants(grantee_company_id);
CREATE INDEX IF NOT EXISTS idx_vag_status ON vendor_access_grants(status);

-- ─── RLS — 1번 PR 임시 정책 ───
-- 양쪽 당사자가 본인 관련 row 만 조회. 4번 PR 에서 vendor_access_grants 가 vendors 의
-- SELECT 정책 안에서 사용되면서 본격 운영 시작.
ALTER TABLE vendor_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_access_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vag_select_own_party" ON vendor_access_grants;
CREATE POLICY "vag_select_own_party" ON vendor_access_grants
  FOR SELECT
  USING (
    grantor_company_id = public.current_company_id()
    OR grantee_company_id = public.current_company_id()
  );

DROP POLICY IF EXISTS "vag_grantee_insert" ON vendor_access_grants;
CREATE POLICY "vag_grantee_insert" ON vendor_access_grants
  FOR INSERT
  WITH CHECK (grantee_company_id = public.current_company_id());

DROP POLICY IF EXISTS "vag_grantor_update" ON vendor_access_grants;
CREATE POLICY "vag_grantor_update" ON vendor_access_grants
  FOR UPDATE
  USING (grantor_company_id = public.current_company_id())
  WITH CHECK (grantor_company_id = public.current_company_id());

GRANT SELECT, INSERT, UPDATE ON vendor_access_grants TO service_role;
