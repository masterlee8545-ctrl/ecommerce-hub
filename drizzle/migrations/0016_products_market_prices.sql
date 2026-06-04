-- ============================================================
-- 0016_products_market_prices.sql — products 시장 가격 컬럼 추가
-- ============================================================
-- 출처: 형 요청 — 상품 카드에 쿠팡/네이버 상위 10개 가격대 표시
-- 헌법: CLAUDE.md §1 P-3 (estimated 강제, 가격은 scraped 데이터)
--
-- 동기:
--   형 소싱 판단에 핵심 — "이 가격 밑으로 가능?" 즉시 확인
--   쿠팡 1페이지 1~10등 가격 통계 + 네이버 쇼핑 1~10등 가격 통계
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS coupang_price_min numeric(12, 0),
  ADD COLUMN IF NOT EXISTS coupang_price_median numeric(12, 0),
  ADD COLUMN IF NOT EXISTS coupang_price_max numeric(12, 0),
  ADD COLUMN IF NOT EXISTS coupang_price_sample_size integer,
  ADD COLUMN IF NOT EXISTS naver_price_min numeric(12, 0),
  ADD COLUMN IF NOT EXISTS naver_price_median numeric(12, 0),
  ADD COLUMN IF NOT EXISTS naver_price_max numeric(12, 0),
  ADD COLUMN IF NOT EXISTS naver_price_sample_size integer,
  ADD COLUMN IF NOT EXISTS market_prices_updated_at timestamptz;
