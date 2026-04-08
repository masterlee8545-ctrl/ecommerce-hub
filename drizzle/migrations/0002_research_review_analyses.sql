-- ============================================================
-- 0002_research_review_analyses.sql — D-1 신규 표 + RLS
-- ============================================================
-- 출처: src/db/schema/research-review-analyses.ts
-- 헌법: CLAUDE.md §1 P-3 (estimated 마킹), §1 P-4 (멀티테넌트)
-- ADR: ADR-007 (AI 출력은 *_estimated)
--
-- 적용 방법:
--   psql $DATABASE_URL -f drizzle/migrations/0002_research_review_analyses.sql
--   또는: drizzle-kit migrate (0001 다음 순서로 자동 적용)
--
-- 변경 금지: 이 파일은 한 번 적용되면 절대 수정 금지 (P-6).
-- 정책 변경이 필요하면 새 마이그레이션 파일(0003_*) 생성.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 표 생성
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_review_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 키 (P-4)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 입력 스냅샷 (재현·디버깅용)
  product_hint text,
  raw_text_excerpt text NOT NULL,
  raw_text_length integer NOT NULL,

  -- AI 분석 결과 (AnalyzeResult 스키마 jsonb)
  result jsonb NOT NULL,

  -- 메타
  model text NOT NULL,
  confidence text NOT NULL DEFAULT 'estimated',  -- P-3 강제

  -- 시간 + 작성자
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

-- ────────────────────────────────────────────────────────────
-- 2. 인덱스 — 회사별 최신 히스토리 조회
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS rra_company_created_idx
  ON research_review_analyses (company_id, created_at);

-- ────────────────────────────────────────────────────────────
-- 3. RLS 정책 — 회사별 격리 (P-4)
-- ────────────────────────────────────────────────────────────
ALTER TABLE research_review_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_review_analyses FORCE ROW LEVEL SECURITY;

CREATE POLICY research_review_analyses_isolation ON research_review_analyses
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ────────────────────────────────────────────────────────────
-- 4. confidence 강제 (P-3) — DB 레벨 체크 제약
-- ────────────────────────────────────────────────────────────
-- AI 분석 결과는 영원히 'estimated'다. 다른 값이 들어오면 INSERT 실패.
ALTER TABLE research_review_analyses
  ADD CONSTRAINT research_review_analyses_confidence_estimated
  CHECK (confidence = 'estimated');

COMMENT ON TABLE research_review_analyses IS
  '쿠팡 리뷰 AI 분석 결과 (D-1). 모든 행은 confidence=estimated 강제 (P-3 + ADR-007).';
