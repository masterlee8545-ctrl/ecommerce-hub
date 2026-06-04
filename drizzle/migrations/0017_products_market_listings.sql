-- ============================================================
-- 0017_products_market_listings.sql — 상위 10개 상품명+가격 jsonb
-- ============================================================
-- 형 요청: 농산물은 중량/개수 다양해서 평균만으론 부족.
-- 1~10등 상품명 + 가격 + URL 다 저장해서 카드에 나열.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS coupang_top_listings jsonb,
  ADD COLUMN IF NOT EXISTS naver_top_listings jsonb;
