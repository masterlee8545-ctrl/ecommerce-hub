-- ============================================================
-- 0005_enable_rls_for_sourcing_workflow.sql — 0004 테이블에 RLS 적용
-- ============================================================
-- 출처: 0004_sourcing_workflow.sql 에서 생성한 2개 표
-- 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리)
--
-- 전제조건:
--   1. 0001_rls_policies.sql 이 먼저 적용되어 public.current_company_id() 함수가
--      존재해야 한다.
--   2. 0004_sourcing_workflow.sql 이 먼저 적용되어 product_plans 및
--      marketing_activities 테이블이 존재해야 한다.
--
-- 적용 방법:
--   npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0005_enable_rls_for_sourcing_workflow
--
-- 변경 금지: 한 번 적용되면 절대 수정 금지. 수정 필요 시 0006_* 생성.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- product_plans
-- ────────────────────────────────────────────────────────────
ALTER TABLE product_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY product_plans_isolation ON product_plans
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ────────────────────────────────────────────────────────────
-- marketing_activities
-- ────────────────────────────────────────────────────────────
ALTER TABLE marketing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY marketing_activities_isolation ON marketing_activities
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
