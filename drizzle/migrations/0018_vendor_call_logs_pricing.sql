-- ============================================================
-- 0018_vendor_call_logs_pricing.sql — 공급가/MOQ 컬럼 추가
-- ============================================================
-- 형 요청: 통화 후 공급가 + MOQ 즉시 기록할 곳
-- ADR-010: vendor_call_logs 는 INSERT-only (immutable) — 컬럼 추가만 OK
-- ============================================================

ALTER TABLE vendor_call_logs
  ADD COLUMN IF NOT EXISTS supplier_price numeric(12, 0),
  ADD COLUMN IF NOT EXISTS supplier_price_unit text,
  ADD COLUMN IF NOT EXISTS moq integer,
  ADD COLUMN IF NOT EXISTS moq_unit text;

-- 단위 예시:
-- supplier_price_unit: 'kg' | '박스' | '개' | 'L'
-- moq_unit: '박스' | '개' | 'kg'
