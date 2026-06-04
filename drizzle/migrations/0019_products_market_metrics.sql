-- 카드에 표시할 메트릭 — 형 요청
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS coupang_avg_review_count integer,
  ADD COLUMN IF NOT EXISTS coupang_max_review_count integer,
  ADD COLUMN IF NOT EXISTS monthly_search_volume integer;
