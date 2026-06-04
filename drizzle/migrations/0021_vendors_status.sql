-- ============================================================
-- 0021_vendors_status.sql — 농가 상태/메모 컬럼
-- ============================================================
-- 형 요청: 통화 실패 / 없는번호 / 소싱 실패 → 탈락 표시할 곳
--
-- vendors 는 회사별 격리 (멀티테넌트) — status 도 자동 격리됨.
-- ============================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS work_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_note text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

-- work_status 값:
-- 'active'         — 정상 (기본)
-- 'no_phone'       — 번호 없음/잘못된 번호
-- 'no_answer'      — 통화 실패/부재중
-- 'sourcing_failed'— 소싱 실패 (가격/조건 안 맞음)
-- 'dropped'        — 탈락 (영구 제외)
-- 'contracted'     — 거래 시작 (좋음)

ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_work_status_check;
ALTER TABLE vendors
  ADD CONSTRAINT vendors_work_status_check
    CHECK (work_status IN ('active', 'no_phone', 'no_answer', 'sourcing_failed', 'dropped', 'contracted'));

CREATE INDEX IF NOT EXISTS idx_vendors_work_status
  ON vendors(work_status) WHERE work_status IS NOT NULL AND work_status != 'active';
