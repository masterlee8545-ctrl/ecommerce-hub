-- ============================================================
-- 0022_market_quality_metrics.sql — 상품 선정 보완 지표
-- ============================================================
-- 형 상품 선정 기준 보완 (2026-06-11):
--   1) 상위 독점도 — 리뷰 적은 자리가 있어도 1등이 다 먹는 시장 거르기
--   2) 광고 비중 — 1페이지 광고 수 (높으면 광고비 필수 시장)
--   3) 검색량 성장률 — 하락 키워드는 1달 뒤 도착 시점에 더 작아짐
--
-- 데이터 출처: 셀록홈즈 keyword-caching/recent + keyword_chart_daily
-- ============================================================

ALTER TABLE products
  -- 1페이지 광고(isAd) 상품 수 — keyword-caching shoppingList 의 필터 전 카운트
  ADD COLUMN IF NOT EXISTS coupang_ad_count integer,
  -- 1위 상품 리뷰 점유율 % (top1 리뷰 / 1페이지 전체 리뷰 합)
  ADD COLUMN IF NOT EXISTS coupang_top1_share numeric(5,1),
  -- 상위 3개 리뷰 점유율 %
  ADD COLUMN IF NOT EXISTS coupang_top3_share numeric(5,1),
  -- 검색량 성장률 % — 최근 91일 평균 ratio vs 작년 같은 91일 평균 (keyword_chart_daily)
  ADD COLUMN IF NOT EXISTS search_growth_pct numeric(6,1);

COMMENT ON COLUMN products.coupang_ad_count IS '쿠팡 1페이지 광고 상품 수 (8+ 이면 광고 의존 시장)';
COMMENT ON COLUMN products.coupang_top1_share IS '1위 리뷰 점유율 % (30%+ 이면 독점 시장 경고)';
COMMENT ON COLUMN products.coupang_top3_share IS '상위3 리뷰 점유율 %';
COMMENT ON COLUMN products.search_growth_pct IS '검색량 YoY 성장률 % (최근 91일 vs 작년 동기)';
