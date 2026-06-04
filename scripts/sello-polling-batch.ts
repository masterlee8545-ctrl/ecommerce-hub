#!/usr/bin/env node
/**
 * 셀록홈즈 polling batch
 *
 * 흐름:
 *   1) 100개 상품 키워드 큐에 적재
 *   2) 각 키워드 keyword-caching/recent 호출
 *   3) data 있으면 DB UPDATE + done 리스트로 이동
 *   4) null 이면 pending 리스트로 다시 (형이 검색할 때까지 대기)
 *   5) 30초마다 pending 재시도
 *   6) 모든 키워드 done 또는 형 Ctrl+C
 *
 * 형은 셀록홈즈에서 키워드 검색만 하면 됨. 검색 후 캐시 채워지면 batch 자동 수집.
 */
import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import {
  SellochomesError,
  fetchKeywordCaching,
  type SCKeywordCachingItem,
} from '../src/lib/sellochomes/client';

interface QueueItem {
  id: string;
  code: string;
  name: string;
  company_id: string;
  attempts: number;
  lastError?: string;
}

const POLL_INTERVAL_MS = 4_000; // 한 키워드 호출 간격
const MAX_ATTEMPTS = 30; // 키워드당 최대 시도 (= 약 2분)
const PASS_INTERVAL_MS = 20_000; // 한 패스 끝나면 다음 패스까지 대기

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1]! + s[m]!) / 2) : s[m]!;
}

async function saveProduct(
  q: QueueItem,
  item: SCKeywordCachingItem,
): Promise<{ real: number; under300: number; rocket: number; monthly: number | null }> {
  const list = item.data.coupang.shoppingList ?? [];
  const real = list.filter((it) => !it.isAd && !it.isPb);
  const prices = real.map((it) => it.price).filter((n) => n > 0);
  const reviews = real.map((it) => it.reviewCnt).filter((n) => n >= 0);
  const under300 = reviews.filter((r) => r < 300).length;
  const rocket = real.filter(
    (it) => it.shippingMethod === 'rocket' || it.koShippingMethod === '로켓배송',
  ).length;

  const topListings = real.slice(0, 20).map((it) => ({
    rank: it.rank,
    title: it.title,
    price: it.price,
    isRocket:
      it.shippingMethod === 'rocket' || it.koShippingMethod === '로켓배송',
    shippingLabel: it.koShippingMethod,
    reviewCount: it.reviewCnt,
    url: it.url,
    imageUrl: it.prdImg,
  }));

  await withCompanyContext(q.company_id, async (tx) => {
    await tx
      .update(products)
      .set({
        coupang_price_min: prices.length > 0 ? Math.min(...prices).toString() : null,
        coupang_price_median: median(prices)?.toString() ?? null,
        coupang_price_max: prices.length > 0 ? Math.max(...prices).toString() : null,
        coupang_price_sample_size: real.length,
        coupang_top_listings: topListings,
        coupang_avg_review_count:
          reviews.length > 0
            ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length)
            : null,
        coupang_max_review_count: reviews.length > 0 ? Math.max(...reviews) : null,
        coupang_low_review_count: under300,
        monthly_search_volume: item.data.naver.monthlyQcCnt ?? null,
        market_prices_updated_at: new Date(),
      })
      .where(eq(products.id, q.id));
  });

  return { real: real.length, under300, rocket, monthly: item.data.naver.monthlyQcCnt ?? null };
}

let shuttingDown = false;
process.on('SIGINT', () => {
  console.log('\n[batch] 종료 신호 — 현재 패스 완료 후 종료');
  shuttingDown = true;
});

(async () => {
  console.log('=== 셀록홈즈 polling batch 시작 ===');
  console.log('   형은 셀록홈즈에서 키워드 검색만 하면 됨.');
  console.log('   배치가 데이터 자동 수집하여 DB 저장.');
  console.log('   종료: Ctrl+C\n');

  // 큐 적재
  const allCompanies = await db.select().from(companies);
  const queue: QueueItem[] = [];
  for (const co of allCompanies) {
    const ps = await db
      .select({ id: products.id, name: products.name, code: products.code })
      .from(products)
      .where(eq(products.company_id, co.id));
    for (const p of ps) {
      queue.push({ ...p, company_id: co.id, attempts: 0 });
    }
  }
  console.log(`총 ${queue.length}개 상품 큐 적재\n`);

  let pending = [...queue];
  let pass = 0;
  let totalDone = 0;
  let totalFail = 0;

  while (pending.length > 0 && !shuttingDown) {
    pass++;
    console.log(`\n=== 패스 ${pass} (남은 ${pending.length}개) ===`);
    const nextPending: QueueItem[] = [];

    for (const q of pending) {
      if (shuttingDown) break;
      q.attempts++;
      const label = `[${q.code}] ${q.name}`;
      try {
        const item = await fetchKeywordCaching(q.name);
        const r = await saveProduct(q, item);
        totalDone++;
        const grade =
          r.under300 >= 12 ? 'S' : r.under300 >= 6 ? 'A' : r.under300 >= 2 ? 'B' : 'C';
        console.log(
          `  ✅ ${label}: 네이버 ${r.monthly?.toLocaleString() ?? '-'}, 리뷰<300 ${r.under300}/${r.real} [${grade}], 로켓 ${r.rocket}`,
        );
      } catch (e) {
        const code = e instanceof SellochomesError ? e.code : 'unknown';
        if (code === 'auth_expired') {
          console.error(`\n🚫 ${label}: 세션 만료. /settings 에서 쿠키 재발급 필요. 중단.`);
          shuttingDown = true;
          break;
        }
        if (q.attempts >= MAX_ATTEMPTS) {
          totalFail++;
          console.log(
            `  ❌ ${label}: ${q.attempts}회 시도 실패 (${code}) — 포기`,
          );
        } else {
          q.lastError = code;
          nextPending.push(q);
          console.log(
            `  ⏳ ${label}: ${code} (시도 ${q.attempts}/${MAX_ATTEMPTS} — 다음 패스로)`,
          );
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    pending = nextPending;
    console.log(
      `\n[패스 ${pass} 종료] 누적: 성공 ${totalDone}, 포기 ${totalFail}, 대기 ${pending.length}`,
    );

    if (pending.length > 0 && !shuttingDown) {
      console.log(
        `   ${PASS_INTERVAL_MS / 1000}초 후 재시도 — 형이 셀록홈즈에서 검색하면 다음 패스에서 채워짐`,
      );
      await new Promise((r) => setTimeout(r, PASS_INTERVAL_MS));
    }
  }

  console.log(`\n=== 최종 ===`);
  console.log(`  성공: ${totalDone}`);
  console.log(`  포기: ${totalFail}`);
  console.log(`  미처리(중단): ${pending.length}`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error('치명적:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
