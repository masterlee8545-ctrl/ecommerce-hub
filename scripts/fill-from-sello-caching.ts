#!/usr/bin/env node
/**
 * 셀록홈즈 keyword-caching/recent endpoint 로 100개 상품 시장 데이터 채우기
 *
 * 데이터:
 *   - 네이버 월 검색량 (monthly_search_volume)
 *   - 쿠팡 1~20등 listings (광고/PB 제외)
 *   - 가격 통계 (min/median/max)
 *   - 리뷰 통계 (avg/max + 300 이하 개수 = 진입 가능성)
 *
 * 워커/캐시 없이 직접 호출 — 키워드당 ~1초, 100개 약 2분.
 */
import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import {
  SellochomesError,
  analyzeKeywordCaching,
  fetchKeywordCaching,
} from '../src/lib/sellochomes/client';

const DELAY_MS = 500; // 셀록홈즈 부담 줄이기

interface ProcessedCounts {
  total: number;
  filled: number;
  failed: number;
  emptyShoppingList: number;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

(async () => {
  console.log('=== 셀록홈즈 keyword-caching → 시장 데이터 채우기 ===\n');
  const counts: ProcessedCounts = { total: 0, filled: 0, failed: 0, emptyShoppingList: 0 };
  const allCompanies = await db.select().from(companies);

  for (const co of allCompanies) {
    const rows = await db
      .select({ id: products.id, name: products.name, code: products.code })
      .from(products)
      .where(eq(products.company_id, co.id));
    if (rows.length === 0) continue;

    console.log(`\n[${co.name}] ${rows.length}개`);

    for (const p of rows) {
      counts.total++;
      try {
        const item = await fetchKeywordCaching(p.name);
        const list = item.data.coupang.shoppingList ?? [];
        const real = list.filter((it) => !it.isAd && !it.isPb);

        if (real.length === 0) {
          counts.emptyShoppingList++;
          console.log(`  ⏭ ${p.code} ${p.name}: shoppingList 비어있음`);
          await new Promise((r) => setTimeout(r, DELAY_MS));
          continue;
        }

        const prices = real.map((it) => it.price).filter((n) => n > 0);
        const reviews = real.map((it) => it.reviewCnt).filter((n) => n >= 0);
        const dist = analyzeKeywordCaching(item, { threshold: 300, majorityCount: 12 });

        // 선정 보완 지표 (0022)
        const adCount = list.filter((it) => it.isAd).length;
        const reviewTotal = reviews.reduce((a, b) => a + b, 0);
        const sortedReviews = [...reviews].sort((a, b) => b - a);
        const top1Share =
          reviewTotal > 0 ? (((sortedReviews[0] ?? 0) / reviewTotal) * 100).toFixed(1) : null;
        const top3Share =
          reviewTotal > 0
            ? ((sortedReviews.slice(0, 3).reduce((a, b) => a + b, 0) / reviewTotal) * 100).toFixed(1)
            : null;

        const topListings = real.slice(0, 20).map((it) => ({
          rank: it.rank,
          title: it.title,
          price: it.price,
          isRocket: it.shippingMethod === 'rocket' || it.koShippingMethod === '로켓배송',
          shippingLabel: it.koShippingMethod,
          reviewCount: it.reviewCnt,
          url: it.url,
          imageUrl: it.prdImg,
        }));

        const coupangMin = prices.length > 0 ? Math.min(...prices) : null;
        const coupangMax = prices.length > 0 ? Math.max(...prices) : null;
        const coupangMed = median(prices);
        const coupangAvgReview =
          reviews.length > 0
            ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length)
            : null;
        const coupangMaxReview = reviews.length > 0 ? Math.max(...reviews) : null;
        const naverMonthly = item.data.naver.monthlyQcCnt ?? null;

        await withCompanyContext(co.id, async (tx) => {
          await tx
            .update(products)
            .set({
              coupang_price_min: coupangMin?.toString() ?? null,
              coupang_price_median: coupangMed?.toString() ?? null,
              coupang_price_max: coupangMax?.toString() ?? null,
              coupang_price_sample_size: real.length,
              coupang_top_listings: topListings,
              coupang_avg_review_count: coupangAvgReview,
              coupang_max_review_count: coupangMaxReview,
              coupang_low_review_count: dist.underThresholdCount,
              coupang_ad_count: adCount,
              coupang_top1_share: top1Share,
              coupang_top3_share: top3Share,
              monthly_search_volume: naverMonthly,
              market_prices_updated_at: new Date(),
            })
            .where(eq(products.id, p.id));
        });

        counts.filled++;
        const grade =
          dist.underThresholdCount >= 12
            ? 'S'
            : dist.underThresholdCount >= 6
              ? 'A'
              : dist.underThresholdCount >= 2
                ? 'B'
                : 'C';
        console.log(
          `  ✅ ${p.code} ${p.name}: 네이버 ${naverMonthly?.toLocaleString() ?? '-'}/월, ` +
            `쿠팡 ${coupangMed?.toLocaleString() ?? '-'}원 (n=${real.length}), ` +
            `리뷰<300 ${dist.underThresholdCount}/${real.length} [${grade}]`,
        );
      } catch (e) {
        counts.failed++;
        const msg =
          e instanceof SellochomesError
            ? `${e.code} ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        console.warn(`  ❌ ${p.code} ${p.name}: ${msg}`);
        // 인증 만료면 batch 전체 중단
        if (e instanceof SellochomesError && e.code === 'auth_expired') {
          console.error(`\n🚫 세션 만료 — batch 중단. /settings 에서 쿠키 재발급 필요.`);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n=== 결과 ===`);
  console.log(`  처리 시도: ${counts.total}`);
  console.log(`  데이터 채움: ${counts.filled}`);
  console.log(`  shoppingList 비어있음: ${counts.emptyShoppingList}`);
  console.log(`  실패: ${counts.failed}`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error('치명적:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
