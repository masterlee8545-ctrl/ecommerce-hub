-- ============================================================
-- 0011_vendor_products.sql — 농가 ↔ 취급 품목 다대다 (ADR-012)
-- ============================================================
-- 출처: src/db/schema/vendor-products.ts, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.10
-- 헌법: CLAUDE.md §1 P-3 (신뢰도), §1 P-4/P-5 (멀티테넌트)
-- ADR: ADR-012
--
-- 동기:
--   농가 1명이 여러 품목(예: 참외, 토마토, 멜론) 을 취급. 자동 매칭(2번 PR) 의 기반 인덱스.
--   사이소의 productKeywordsAll 콤마 텍스트를 row 로 분해해서 저장.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  product_keyword text NOT NULL,               -- 정규화된 품목 키워드

  -- 매칭 보강
  source text,                                 -- '사이소-productKeywordsAll' | '사용자-수동'
  confidence text NOT NULL DEFAULT 'estimated', -- P-3

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vendor_products_unique UNIQUE (vendor_id, product_keyword),
  CONSTRAINT vendor_products_confidence_check
    CHECK (confidence IN ('confirmed', 'estimated', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_keyword ON vendor_products(product_keyword);
CREATE INDEX IF NOT EXISTS idx_vendor_products_company ON vendor_products(company_id);

-- ─── RLS — 1번 PR: 회사 격리만 ───
-- 4번 PR 에서 SELECT 정책에 vendor_access_grants 조건 추가 예정
ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_products FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vp_isolation" ON vendor_products;
CREATE POLICY "vp_isolation" ON vendor_products
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT ALL ON vendor_products TO service_role;
