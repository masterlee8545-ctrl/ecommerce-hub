-- ============================================================
-- 0009_keyword_charts.sql — 셀록홈즈 chart API 일별 ratio 영구 캐시
-- ============================================================
-- 출처: src/db/schema/keyword-charts.ts
-- 헌법: CLAUDE.md §1 P-1 (멀티테넌트), §1 P-7 (RLS)
--
-- 동기:
--   시즌 분석을 위해 셀록홈즈 chart API 의 일별 ratio (10년치, ~3,800 row/키워드)
--   를 영구 보관. 외부 공개 데이터라 멀티테넌트 X — 모든 회사 공유.
--   24시간 단위 캐시 갱신, 일별 데이터 자체는 한번 받으면 영구 (변동 X).
--
-- 테이블:
--   - keyword_chart_daily   : 일별 ratio (영구)
--   - keyword_chart_fetches : 마지막 fetch 시점 (24h 캐시 판단)
--
-- 사이즈 추정:
--   - 1,000 키워드 × 3,800 일 = 380만 row → ~120MB (인덱스 포함)
--   - 5,000 키워드 → ~600MB (Vercel Postgres 무료 한도 안 — 1GB)
--
-- 적용:
--   npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0009_keyword_charts
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- keyword_chart_daily — 일별 ratio
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyword_chart_daily (
  keyword text NOT NULL,
  period  text NOT NULL,             -- 'YYYY-MM-DD'
  ratio   real NOT NULL,             -- 0~100 상대지수
  PRIMARY KEY (keyword, period)
);

CREATE INDEX IF NOT EXISTS kcd_keyword_idx       ON keyword_chart_daily (keyword);
CREATE INDEX IF NOT EXISTS kcd_period_idx        ON keyword_chart_daily (period);
CREATE INDEX IF NOT EXISTS kcd_keyword_period_idx ON keyword_chart_daily (keyword, period);

-- RLS — 인증된 사용자만 read, write 는 service_role (worker, API)
ALTER TABLE keyword_chart_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kcd_authenticated_select" ON keyword_chart_daily;
CREATE POLICY "kcd_authenticated_select" ON keyword_chart_daily
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "kcd_authenticated_modify" ON keyword_chart_daily;
CREATE POLICY "kcd_authenticated_modify" ON keyword_chart_daily
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON keyword_chart_daily TO service_role;

-- ───────────────────────────────────────────────────────────
-- keyword_chart_fetches — 마지막 fetch 메타
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyword_chart_fetches (
  keyword          text PRIMARY KEY,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  data_start_date  text,              -- 가장 이른 데이터 날짜
  data_end_date    text,              -- 가장 최근 데이터 날짜
  point_count      integer NOT NULL DEFAULT 0,
  last_status      text NOT NULL DEFAULT 'ok',  -- 'ok' | 'auth_expired' | 'no_data' | 'error'
  last_error       text
);

CREATE INDEX IF NOT EXISTS kcf_fetched_at_idx ON keyword_chart_fetches (fetched_at);

ALTER TABLE keyword_chart_fetches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kcf_authenticated_select" ON keyword_chart_fetches;
CREATE POLICY "kcf_authenticated_select" ON keyword_chart_fetches
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "kcf_authenticated_modify" ON keyword_chart_fetches;
CREATE POLICY "kcf_authenticated_modify" ON keyword_chart_fetches
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON keyword_chart_fetches TO service_role;
