-- ============================================================
-- 0013_product_vendor_candidates.sql — 상품 ↔ 농가 공급처 후보
-- ============================================================
-- 출처: src/db/schema/product-vendor-candidates.ts, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.12
-- 헌법: CLAUDE.md §1 P-4/P-5 (멀티테넌트)
-- ADR: ADR-012, ADR-013 D-3 (회사별 격리)
--
-- 동기:
--   상품 1개에 농가 후보 N명 매핑. 자동 매칭(2번 PR) 결과 + 사용자가 [⭐ 후보] / [❌ 탈락] 누른 결정.
--   1번 PR 에서 스키마만, 활용은 2번 PR.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_vendor_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id uuid NOT NULL REFERENCES companies(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),

  -- 후보 상태
  status text NOT NULL DEFAULT '후보',
    -- '후보' | '통화중' | '견본중' | '확정' | '탈락'

  -- 매칭 정보
  match_score numeric(5, 2),                   -- 자동 매칭 점수 (0~100)
  match_reason text,                           -- 매칭 근거 (예: '품목 정확 일치 + 지역 가산')

  -- 사용자 메모
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),

  CONSTRAINT pvc_unique UNIQUE (product_id, vendor_id),
  CONSTRAINT pvc_status_check
    CHECK (status IN ('후보', '통화중', '견본중', '확정', '탈락'))
);

CREATE INDEX IF NOT EXISTS idx_pvc_product ON product_vendor_candidates(product_id);
CREATE INDEX IF NOT EXISTS idx_pvc_vendor ON product_vendor_candidates(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pvc_status ON product_vendor_candidates(status);
CREATE INDEX IF NOT EXISTS idx_pvc_company ON product_vendor_candidates(company_id);

-- ─── RLS — 회사 격리 ───
ALTER TABLE product_vendor_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_vendor_candidates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pvc_isolation" ON product_vendor_candidates;
CREATE POLICY "pvc_isolation" ON product_vendor_candidates
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT ALL ON product_vendor_candidates TO service_role;
