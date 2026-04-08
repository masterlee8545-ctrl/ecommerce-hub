-- ============================================================
-- 0001_rls_policies.sql — Row-Level Security 정책
-- ============================================================
-- 출처: docs/DATA_MODEL.md §0.3, §7
-- 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리), §1 P-6 (회계 안전망)
-- ADR: ADR-010 (Audit 표는 INSERT/SELECT만 허용)
--
-- 적용 방법:
--   psql $DATABASE_URL -f drizzle/migrations/0001_rls_policies.sql
--   또는: drizzle-kit migrate (이 파일은 0000 다음 순서로 자동 적용됨)
--
-- 변경 금지: 이 파일은 한 번 적용되면 절대 수정 금지 (P-6).
-- 정책 변경이 필요하면 새 마이그레이션 파일(0002_*) 생성.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 헬퍼 함수 — 현재 요청의 회사 ID 추출
-- ────────────────────────────────────────────────────────────
-- 사용 흐름:
--   1) Next.js 미들웨어/서버 컴포넌트에서 withCompanyContext(companyId, fn) 호출
--   2) 트랜잭션 안에서 SET LOCAL app.current_company_id = '...' 실행
--   3) 모든 RLS 정책이 이 함수를 호출해 자동 차단
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION public.current_company_id() IS
  '현재 요청의 회사 ID. SET LOCAL app.current_company_id로 주입됨. 없으면 NULL 반환.';

-- ────────────────────────────────────────────────────────────
-- 2. companies — 자기 회사만 SELECT 허용
-- ────────────────────────────────────────────────────────────
-- 특이점: companies 표는 company_id 컬럼이 없음 (id 자체가 회사 ID)
-- ────────────────────────────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;

CREATE POLICY companies_select_self ON companies
  FOR SELECT
  USING (id = public.current_company_id());

-- INSERT/UPDATE/DELETE는 슈퍼유저(시드/마이그레이션 스크립트)만 허용
-- → 일반 앱 런타임에서는 차단됨 (정책 없음 = FORCE RLS이므로 거부)

-- ────────────────────────────────────────────────────────────
-- 3. 그룹 B — 파이프라인 (8 표)
-- ────────────────────────────────────────────────────────────

-- ── 3.1 suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_isolation ON suppliers
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.2 keywords
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY keywords_isolation ON keywords
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.3 coupang_review_snapshots
ALTER TABLE coupang_review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupang_review_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY coupang_review_snapshots_isolation ON coupang_review_snapshots
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.4 products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_isolation ON products
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.5 product_state_history (IMMUTABLE — ADR-010)
ALTER TABLE product_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_state_history FORCE ROW LEVEL SECURITY;

CREATE POLICY product_state_history_select ON product_state_history
  FOR SELECT
  USING (company_id = public.current_company_id());

CREATE POLICY product_state_history_insert ON product_state_history
  FOR INSERT
  WITH CHECK (company_id = public.current_company_id());

-- UPDATE / DELETE 정책 일부러 만들지 않음 → 거부됨 (immutable 보장)

-- ── 3.6 quotes
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY quotes_isolation ON quotes
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.7 purchase_orders
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_isolation ON purchase_orders
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 3.8 listings
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings FORCE ROW LEVEL SECURITY;
CREATE POLICY listings_isolation ON listings
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ────────────────────────────────────────────────────────────
-- 4. 그룹 C — 마케팅 (6 표)
-- ────────────────────────────────────────────────────────────

-- ── 4.1 ad_campaigns
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY ad_campaigns_isolation ON ad_campaigns
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 4.2 ad_groups
ALTER TABLE ad_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY ad_groups_isolation ON ad_groups
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 4.3 ad_keywords
ALTER TABLE ad_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY ad_keywords_isolation ON ad_keywords
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 4.4 ad_metrics
ALTER TABLE ad_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY ad_metrics_isolation ON ad_metrics
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 4.5 seo_targets
ALTER TABLE seo_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_targets_isolation ON seo_targets
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 4.6 keyword_rankings
ALTER TABLE keyword_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY keyword_rankings_isolation ON keyword_rankings
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ────────────────────────────────────────────────────────────
-- 5. 그룹 D — 운영 (4 표)
-- ────────────────────────────────────────────────────────────

-- ── 5.1 tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_isolation ON tasks
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 5.2 task_history (IMMUTABLE — ADR-010)
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_history FORCE ROW LEVEL SECURITY;

CREATE POLICY task_history_select ON task_history
  FOR SELECT
  USING (company_id = public.current_company_id());

CREATE POLICY task_history_insert ON task_history
  FOR INSERT
  WITH CHECK (company_id = public.current_company_id());

-- UPDATE / DELETE 정책 만들지 않음 → 거부됨 (immutable 보장)

-- ── 5.3 tariff_presets
ALTER TABLE tariff_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_presets FORCE ROW LEVEL SECURITY;
CREATE POLICY tariff_presets_isolation ON tariff_presets
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ── 5.4 notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_isolation ON notifications
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ────────────────────────────────────────────────────────────
-- 6. users / user_companies — RLS 미적용 (auth 인프라)
-- ────────────────────────────────────────────────────────────
-- 이 두 표는 회사 컨텍스트가 결정되기 *전*에 조회되어야 한다.
-- (사용자가 어느 회사에 속했는지 알아야 활성 회사를 결정할 수 있음)
--
-- 보호 방식:
-- - 앱 코드에서만 직접 쿼리 (auth/user.ts)
-- - users.password_hash는 절대 클라이언트에 노출 금지
-- - Supabase anon 키로는 접근 차단 (DB role 권한으로 분리)
-- ────────────────────────────────────────────────────────────

-- 명시적으로 RLS 미적용임을 표시 (혹시 모를 자동화 도구를 위해)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies DISABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 7. 검증 쿼리 (수동 실행용 — 마이그레이션 후 확인)
-- ────────────────────────────────────────────────────────────
-- 아래 주석을 풀고 psql에서 실행하면 RLS가 적용된 표 목록을 볼 수 있다.
--
-- SELECT schemaname, tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- 기대 결과: 19개 표(companies + 18개 비즈니스 표) rowsecurity = true
--          users, user_companies = false
-- ────────────────────────────────────────────────────────────
