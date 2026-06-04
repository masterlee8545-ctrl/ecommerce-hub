-- ============================================================
-- 0012_vendor_call_logs.sql — 농가 통화/카톡/방문 기록 (immutable)
-- ============================================================
-- 출처: src/db/schema/vendor-call-logs.ts, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.11
-- 헌법: CLAUDE.md §1 P-4/P-5 (멀티테넌트 + 영업비밀 격리)
-- ADR: ADR-010 (Audit 표는 INSERT/SELECT 만 허용), ADR-013 D-3 (완전 격리)
--
-- 동기:
--   농가 통화 결과를 30초 안에 기록. 회사별 완전 격리 (다른 회사가 어떤 농가에
--   얼마 제시했는지 못 봄 = 영업 비밀 보호).
--   1번 PR 에서 스키마만, 통화 모달 + 활용은 3번 PR.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 (P-5, ADR-013 D-3 완전 격리)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 대상
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  product_id uuid REFERENCES products(id),     -- 어느 상품 때문에 통화했는지 (nullable)

  -- 통화 내용
  channel text NOT NULL,                       -- 'phone' | 'kakao' | 'visit' | 'other'
  result text NOT NULL,                        -- '연결됨' | '부재중' | ...
  notes text,

  -- 후속 액션 (3번 PR에서 tasks 자동 생성 트리거 추가)
  next_action text,                            -- '재통화' | '견본_대기' | '계약_검토' | NULL
  next_action_at timestamptz,

  -- 통화자
  called_by_user_id uuid NOT NULL REFERENCES users(id),
  called_at timestamptz NOT NULL DEFAULT now(),

  -- ─── 제약 ───
  CONSTRAINT vendor_call_logs_channel_check
    CHECK (channel IN ('phone', 'kakao', 'visit', 'other')),
  CONSTRAINT vendor_call_logs_result_check
    CHECK (result IN ('연결됨', '부재중', '거절', '견본_요청', '거래_시작', '탈락'))
);

CREATE INDEX IF NOT EXISTS idx_vcl_vendor ON vendor_call_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vcl_product ON vendor_call_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_vcl_company ON vendor_call_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_vcl_next_action
  ON vendor_call_logs(next_action_at) WHERE next_action_at IS NOT NULL;

-- ─── RLS — 완전 격리 + IMMUTABLE (ADR-010, ADR-013 D-3) ───
ALTER TABLE vendor_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_call_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vcl_select_own" ON vendor_call_logs;
CREATE POLICY "vcl_select_own" ON vendor_call_logs
  FOR SELECT
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "vcl_insert_own" ON vendor_call_logs;
CREATE POLICY "vcl_insert_own" ON vendor_call_logs
  FOR INSERT
  WITH CHECK (company_id = public.current_company_id());

-- UPDATE/DELETE 정책 일부러 만들지 않음 → 거부됨 (immutable 보장, ADR-010)

GRANT SELECT, INSERT ON vendor_call_logs TO service_role;
