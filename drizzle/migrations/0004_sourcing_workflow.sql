-- ============================================================
-- 0004_sourcing_workflow.sql — 소싱 워크플로우 재구축 (Steps 3·4·5·7)
-- ============================================================
-- 출처: 소싱 워크플로우 Step 3/4/5/7 (2026-04)
-- 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리), §1 P-6 (회계 안전망)
--
-- 변경 내용:
--   Step 3. products.cn_source_url                      — 1688 링크 (수입업체 인계)
--   Step 4. product_plans 테이블                         — 상세페이지 기획서
--   Step 5. products.plan_assignee_id 등 3종 FK          — 담당자 3역할
--   Step 7. marketing_activities 테이블                  — 마케팅 작업 트래킹
--
-- 적용 방법:
--   npm run db:migrate
--   또는: psql $DATABASE_URL -f drizzle/migrations/0004_sourcing_workflow.sql
--
-- 변경 금지: 한 번 적용되면 절대 수정 금지. 수정 필요 시 0005_* 생성.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. products 컬럼 추가 (Step 3 + 5)
-- ────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cn_source_url text;

COMMENT ON COLUMN products.cn_source_url IS
  '1688/타오바오/알리바바 소스 URL. 수입업체에 인계 시 참조.';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS plan_assignee_id uuid REFERENCES users(id);

COMMENT ON COLUMN products.plan_assignee_id IS
  '상세페이지 기획·제작 담당 (Step 4).';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS listing_assignee_id uuid REFERENCES users(id);

COMMENT ON COLUMN products.listing_assignee_id IS
  '상품 등록 담당 (Step 6).';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS rocket_assignee_id uuid REFERENCES users(id);

COMMENT ON COLUMN products.rocket_assignee_id IS
  '로켓 입점 담당 (Step 8).';

-- 담당자별 빠른 조회
CREATE INDEX IF NOT EXISTS products_plan_assignee_idx
  ON products (plan_assignee_id) WHERE plan_assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_listing_assignee_idx
  ON products (listing_assignee_id) WHERE listing_assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_rocket_assignee_idx
  ON products (rocket_assignee_id) WHERE rocket_assignee_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. product_plans 테이블 (Step 4)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 키 (P-4)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 대상 상품 (1:1)
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- 본문
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  hook_summary text,
  target_audience text,
  notes text,

  -- AI 생성 흔적
  ai_prompt_used text,
  result_confidence text NOT NULL DEFAULT 'estimated', -- 'estimated' | 'edited' | 'confirmed'

  -- 시간 + 작성자
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),

  CONSTRAINT product_plans_product_uniq UNIQUE (product_id),
  CONSTRAINT product_plans_confidence_valid
    CHECK (result_confidence IN ('estimated', 'edited', 'confirmed'))
);

-- RLS: 이 DB 에 0001_rls_policies.sql 미적용 상태이므로 스킵.
-- 0005_enable_rls_for_sourcing_workflow.sql 에서 일괄 적용 예정.
COMMENT ON TABLE product_plans IS
  '상세페이지 기획서 (Step 4). 1 상품 : 1 기획서. AI 초안→사용자 수정 워크플로우.';

-- ────────────────────────────────────────────────────────────
-- 3. marketing_activities 테이블 (Step 7)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 키
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 대상 상품
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- 채널 · 상태
  channel text NOT NULL,                     -- MarketingChannel enum
  status text NOT NULL DEFAULT 'pending',    -- MarketingStatus enum

  -- 담당자 · 비용
  assignee_id uuid REFERENCES users(id),
  cost_krw decimal(12, 2),

  -- 진행 타임스탬프
  started_at timestamptz,
  completed_at timestamptz,

  -- 결과
  result_summary text,
  result_url text,
  notes text,

  -- 시간 + 작성자
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),

  CONSTRAINT ma_channel_valid
    CHECK (channel IN (
      'coupang_review', 'naver_review', 'blog', 'instagram',
      'youtube', 'cafe', 'coupang_cpc'
    )),
  CONSTRAINT ma_status_valid
    CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled'))
);

-- 인덱스
CREATE INDEX IF NOT EXISTS ma_product_idx
  ON marketing_activities (product_id, created_at);
CREATE INDEX IF NOT EXISTS ma_company_status_idx
  ON marketing_activities (company_id, status);

-- RLS: 0005_enable_rls_for_sourcing_workflow.sql 에서 일괄 적용 예정.
COMMENT ON TABLE marketing_activities IS
  '마케팅·리뷰 작업 트래킹 (Step 7). 상품당 N개 채널 활동 가능 (블로그/인스타/쿠팡CPC 등).';
