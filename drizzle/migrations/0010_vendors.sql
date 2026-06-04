-- ============================================================
-- 0010_vendors.sql — 국내 농가/공장 마스터 (ADR-012)
-- ============================================================
-- 출처: src/db/schema/vendors.ts, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.9
-- 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹), §1 P-4/P-5 (멀티테넌트), §1 P-7 (RLS)
-- ADR: ADR-012 (vendors 분리), ADR-013 (공유 승인제, RLS 본격 적용은 4번 PR)
--
-- 동기:
--   국내 농가/공장 (사이소·김제몰류) 마스터. suppliers (1688) 와 의미 분리.
--   ~1,833명 데이터를 사업자번호 기반으로 dedup 해서 저장.
--
-- 1번 PR 범위: 회사 격리만. 공유 SELECT (vendor_access_grants 조건) 은 4번 PR.
--
-- 적용:
--   npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0010_vendors
-- ============================================================

CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 (P-5)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- ─── 식별 ───
  slug text NOT NULL,                          -- 사이소 sellerId / jpsmall slug
  biz_name text NOT NULL,                      -- 업체명
  biz_no text,                                 -- 사업자번호 정규화 (-/공백 제거, 10자리)
  biz_no_confidence text NOT NULL DEFAULT 'estimated',  -- P-3

  -- ─── 대표 ───
  biz_owner_name text,                         -- 대표자명
  repr_tel_no text,                            -- 대표 번호
  biz_mobile text,                             -- 휴대전화
  contact_confidence text NOT NULL DEFAULT 'estimated',

  -- ─── 주소 ───
  biz_address text,                            -- 합성 주소
  biz_zip text,                                -- 우편번호 (사이소)

  -- ─── 업종 (사이소 데이터) ───
  biz_type text,                               -- '제조' | '유통' | '사업자'
  biz_sector text,                             -- 업종 텍스트

  -- ─── 분류 (jpsmall/nongasil 보유, 사이소는 6번 PR에서 후처리) ───
  classification text,                         -- '1차_농가' | '1차_법인' | '가공유통' | ...
  classification_basis text,

  -- ─── 상품 정보 요약 ───
  product_count integer DEFAULT 0,
  product_keywords_all text,                   -- 콤마 구분
  products_top10 text,                         -- JSON/콤마 텍스트

  -- ─── 출처 추적 ───
  source_site text NOT NULL,                   -- '사이소-안동장터' 등
  also_listed_on text[] NOT NULL DEFAULT '{}', -- ['사이소-경주몰', ...]
  source_url text,

  -- ─── 개인정보 (사이소만, ADR-013 D-4) ───
  -- 4번 PR 에서 grantee 회사에 NULL 마스킹 view 추가 예정
  rpers_birthdt date,
  rpers_gender text,

  -- ─── 소개 ───
  intro_html text,

  -- ─── 공통 ───
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),

  -- ─── 제약 ───
  CONSTRAINT vendors_company_slug_unique UNIQUE (company_id, slug),
  CONSTRAINT vendors_biz_no_confidence_check
    CHECK (biz_no_confidence IN ('confirmed', 'estimated', 'unknown')),
  CONSTRAINT vendors_contact_confidence_check
    CHECK (contact_confidence IN ('confirmed', 'estimated', 'unknown'))
);

-- ─── 인덱스 ───
CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(company_id);
CREATE INDEX IF NOT EXISTS idx_vendors_biz_no ON vendors(biz_no) WHERE biz_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_biz_name_gin
  ON vendors USING gin (to_tsvector('simple', biz_name));
CREATE INDEX IF NOT EXISTS idx_vendors_source_site ON vendors(source_site);
CREATE INDEX IF NOT EXISTS idx_vendors_classification ON vendors(classification);

-- ─── RLS — 1번 PR: 회사 격리만 ───
-- 4번 PR 에서 SELECT 정책을 vendor_access_grants 기반으로 교체 예정
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_isolation" ON vendors;
CREATE POLICY "vendors_isolation" ON vendors
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT ALL ON vendors TO service_role;
