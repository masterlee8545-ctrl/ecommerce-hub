-- ============================================================
-- 0006_scrape_jobs.sql — 스크래핑 작업 큐 (Vercel + Supabase + 로컬 워커)
-- ============================================================
-- 출처: src/db/schema/scrape-jobs.ts
-- 헌법: CLAUDE.md §1 P-2 (실패 명시), §1 P-4 (멀티테넌트)
--
-- 배경: Playwright 는 Vercel serverless 에서 동작 불가 → 로컬 PC 워커가 처리.
--       웹(Vercel) 이 jobs 을 INSERT, 로컬 워커가 SELECT FOR UPDATE SKIP LOCKED
--       로 atomic claim 후 스크래핑하고 결과 UPDATE.
--
-- 적용: npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0006_scrape_jobs
--
-- 변경 금지: 적용 후 수정 X. 새 파일(0007_*) 생성.
-- ============================================================

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 키
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 같은 배치 요청의 여러 키워드를 묶는 ID (클라이언트가 생성)
  batch_id uuid NOT NULL,

  -- 스크래핑 대상
  keyword text NOT NULL,

  -- 상태 머신
  status text NOT NULL DEFAULT 'pending',

  -- 옵션
  force_fresh boolean NOT NULL DEFAULT false,
  filter_cond jsonb,

  -- 결과
  result jsonb,
  error text,
  cache_hit boolean NOT NULL DEFAULT false,

  -- 워커 trace
  worker_id text,

  -- 시간
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  requested_by uuid REFERENCES users(id),

  -- 제약
  CONSTRAINT scrape_jobs_status_valid
    CHECK (status IN ('pending','running','done','failed','cancelled')),
  CONSTRAINT scrape_jobs_batch_keyword_uniq UNIQUE (batch_id, keyword)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS scrape_jobs_pending_idx
  ON scrape_jobs (status, requested_at);
CREATE INDEX IF NOT EXISTS scrape_jobs_batch_idx
  ON scrape_jobs (batch_id);
CREATE INDEX IF NOT EXISTS scrape_jobs_company_idx
  ON scrape_jobs (company_id, requested_at);

-- RLS: 0001_rls_policies.sql 미적용 DB 이므로 본 파일에선 스킵.
--      전체 RLS 활성화 시 0005 와 함께 별도 파일에서 일괄 적용.

COMMENT ON TABLE scrape_jobs IS
  '셀록홈즈 스크래핑 작업 큐 (Vercel 웹 ↔ 로컬 워커). Vercel 에선 스크래퍼 동작 불가 — 반드시 로컬 PC 에서 `npm run sello:worker` 상시 실행 필요.';
