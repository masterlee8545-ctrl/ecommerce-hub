-- 형 진짜 기준: 평균 리뷰 X, 20개 중 리뷰 300 이하 상품 몇 개인지
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS coupang_low_review_count integer; -- 1페이지 20개 중 리뷰 300 이하 상품 수
