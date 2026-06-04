#!/usr/bin/env node
/**
 * 등록된 상품 88개의 시장 가격 자동 채우기
 *
 * 데이터 소스:
 *   - 쿠팡: 셀로 캐시 (있으면) → priceStats
 *   - 네이버: 쇼핑 API 호출 (실시간)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/fill-market-prices.ts
 *
 * 소요: 키워드당 ~1초 (네이버 API) → 88개 약 2분
 */
import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { getNaverShopPriceStats } from '../src/lib/research/naver-shop';
import { getCoupangFirstPageMetrics } from '../src/lib/sello-scraper/metrics';

(async () => {
  console.log('=== 시장 가격 자동 채우기 시작 ===\n');

  const allCompanies = await db.select().from(companies);

  let totalProcessed = 0;
  let totalCoupangFilled = 0;
  let totalNaverFilled = 0;

  for (const co of allCompanies) {
    const rows = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.company_id, co.id));
    if (rows.length === 0) continue;

    console.log(`\n[${co.name}] ${rows.length}개 처리...`);

    for (const p of rows) {
      // 쿠팡 캐시
      let coupangMin: number | null = null;
      let coupangMed: number | null = null;
      let coupangMax: number | null = null;
      let coupangN = 0;
      let coupangListings: unknown = null;

      // 형 진짜 기준: 평균 X, "20개 중 리뷰 300 이하 몇 개" (진입 자리)
      let coupangAvgReview: number | null = null;
      let coupangMaxReview: number | null = null;
      let coupangLowReviewCount: number | null = null;

      try {
        const metrics = await getCoupangFirstPageMetrics(p.name);
        if (metrics && metrics.priceStats.sampleSize > 0) {
          coupangMin = metrics.priceStats.min;
          coupangMed = metrics.priceStats.median;
          coupangMax = metrics.priceStats.max;
          coupangN = metrics.priceStats.sampleSize;
          coupangListings = metrics.reviews.slice(0, 20).map((r) => ({
            rank: r.rank,
            title: r.name,
            price: r.price,
            isRocket: r.isRocket,
            reviewCount: r.reviewCount,
            url: r.productUrl,
            imageUrl: r.imageUrl,
          }));
          const reviews = metrics.reviews.map((r) => r.reviewCount).filter((n) => n >= 0);
          if (reviews.length > 0) {
            coupangAvgReview = Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length);
            coupangMaxReview = Math.max(...reviews);
            // 형 핵심: 리뷰 300 이하 상품 수 (진입 자리)
            coupangLowReviewCount = reviews.filter((n) => n <= 300).length;
          }
          totalCoupangFilled++;
        }
      } catch (e) {
        void e;
      }

      // 네이버 쇼핑 API
      let naverMin: number | null = null;
      let naverMed: number | null = null;
      let naverMax: number | null = null;
      let naverN = 0;
      let naverListings: unknown = null;

      try {
        const naver = await getNaverShopPriceStats(p.name, 10);
        if (naver.sampleSize > 0) {
          naverMin = naver.min;
          naverMed = naver.median;
          naverMax = naver.max;
          naverN = naver.sampleSize;
          naverListings = naver.listings;
          totalNaverFilled++;
        }
      } catch (e) {
        console.warn(`  ⚠ 네이버 ${p.name}: ${e instanceof Error ? e.message : e}`);
      }

      // UPDATE
      await withCompanyContext(co.id, async (tx) => {
        await tx
          .update(products)
          .set({
            coupang_price_min: coupangMin?.toString() ?? null,
            coupang_price_median: coupangMed?.toString() ?? null,
            coupang_price_max: coupangMax?.toString() ?? null,
            coupang_price_sample_size: coupangN,
            coupang_top_listings: coupangListings,
            coupang_avg_review_count: coupangAvgReview,
            coupang_max_review_count: coupangMaxReview,
            coupang_low_review_count: coupangLowReviewCount,
            monthly_search_volume: null, // 잘못된 추정 제거 — 별도 셀록홈즈 키워드 페이지 호출 필요
            naver_price_min: naverMin?.toString() ?? null,
            naver_price_median: naverMed?.toString() ?? null,
            naver_price_max: naverMax?.toString() ?? null,
            naver_price_sample_size: naverN,
            naver_top_listings: naverListings,
            market_prices_updated_at: new Date(),
          })
          .where(eq(products.id, p.id));
      });

      const cgInfo = coupangMed ? `쿠팡 ${coupangMed.toLocaleString()}원(${coupangN})` : '쿠팡 -';
      const nvInfo = naverMed ? `네이버 ${naverMed.toLocaleString()}원(${naverN})` : '네이버 -';
      console.log(`  ✅ ${p.name}: ${cgInfo} / ${nvInfo}`);
      totalProcessed++;

      // 네이버 API 한도 보호 — 100ms 딜레이
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\n=== 통계 ===`);
  console.log(`  처리: ${totalProcessed}개`);
  console.log(`  쿠팡 데이터 채워짐: ${totalCoupangFilled}개`);
  console.log(`  네이버 데이터 채워짐: ${totalNaverFilled}개`);

  process.exit(0);
})().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
