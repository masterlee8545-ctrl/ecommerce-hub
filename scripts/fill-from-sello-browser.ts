#!/usr/bin/env node
/**
 * Playwright 으로 셀록홈즈 자동 검색 → keyword-caching/recent 응답 가로채서 DB 저장
 *
 * 전제:
 *   - 형 Chrome 다 닫힌 상태
 *   - 형 일상 Chrome 프로필에 sellochomes OAuth + 셀러라이프 확장 살아있음
 *
 * 흐름:
 *   1) chromium.launchPersistentContext(형 프로필)
 *   2) 셀록홈즈 키워드 분석 페이지 진입
 *   3) 각 키워드마다:
 *      - 검색창에 입력 + 검색 클릭
 *      - keyword-caching/recent 응답 가로채서 데이터 추출
 *      - DB UPDATE
 *      - 5초 대기 (다음 키워드)
 *   4) Chrome 종료
 */
import { eq } from 'drizzle-orm';
import { chromium, type BrowserContext, type Page } from 'playwright';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';

interface ProductRow {
  id: string;
  name: string;
  code: string;
  company_id: string;
}

const SELLOCHOMES_URL =
  'https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword/';
const USER_DATA_DIR = 'C:\\Users\\pc\\AppData\\Local\\Google\\Chrome\\User Data';
const PROFILE_DIR = 'Default';
const POLL_TIMEOUT_MS = 30_000; // 응답 기다리는 최대 시간
const BETWEEN_KEYWORD_MS = 4_000; // 키워드 간 간격 — 셀록홈즈 부담 줄이기

interface SCResponse {
  data?: {
    naver?: { monthlyQcCnt?: number };
    coupang?: {
      totalCnt?: number;
      avgPrice?: number;
      avgReviewCnt?: string;
      maxReviewCnt?: number;
      rocketRatio?: number;
      pbRatio?: number;
      shoppingList?: Array<{
        rank: number;
        price: number;
        title: string;
        reviewCnt: number;
        isAd: boolean;
        isPb: boolean;
        shippingMethod: string;
        koShippingMethod: string;
        url: string;
        prdImg: string;
      }>;
    };
  };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1]! + s[m]!) / 2) : s[m]!;
}

async function searchKeyword(
  page: Page,
  keyword: string,
): Promise<SCResponse | null> {
  // 응답 가로채기 promise — 검색 trigger 전에 설치
  const responsePromise = page
    .waitForResponse(
      (res) =>
        res.url().includes('/api/v1/keyword-caching/recent') &&
        res.status() === 200,
      { timeout: POLL_TIMEOUT_MS },
    )
    .catch(() => null);

  // URL 로 직접 키워드 변경 — SPA 가 알아서 검색 trigger
  const targetUrl = `${SELLOCHOMES_URL}?keyword=${encodeURIComponent(keyword)}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const res = await responsePromise;
  if (!res) return null;
  try {
    const arr = (await res.json()) as Array<SCResponse | null>;
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

async function updateProduct(
  product: ProductRow,
  resp: SCResponse,
): Promise<{ rocket: number; real: number; under300: number; monthly: number | null }> {
  const list = resp.data?.coupang?.shoppingList ?? [];
  const real = list.filter((it) => !it.isAd && !it.isPb);
  const prices = real.map((it) => it.price).filter((n) => n > 0);
  const reviews = real.map((it) => it.reviewCnt).filter((n) => n >= 0);
  const under300 = reviews.filter((r) => r < 300).length;

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

  await withCompanyContext(product.company_id, async (tx) => {
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
        monthly_search_volume: resp.data?.naver?.monthlyQcCnt ?? null,
        market_prices_updated_at: new Date(),
      })
      .where(eq(products.id, product.id));
  });

  const rocketCount = real.filter(
    (it) => it.shippingMethod === 'rocket' || it.koShippingMethod === '로켓배송',
  ).length;
  return {
    rocket: rocketCount,
    real: real.length,
    under300,
    monthly: resp.data?.naver?.monthlyQcCnt ?? null,
  };
}

(async () => {
  console.log('=== Playwright 셀록홈즈 자동 batch ===\n');
  console.log(`profile: ${USER_DATA_DIR}\\${PROFILE_DIR}\n`);

  const allCompanies = await db.select().from(companies);
  const rows: ProductRow[] = [];
  for (const co of allCompanies) {
    const ps = await db
      .select({ id: products.id, name: products.name, code: products.code })
      .from(products)
      .where(eq(products.company_id, co.id));
    for (const p of ps) {
      rows.push({ ...p, company_id: co.id });
    }
  }
  console.log(`처리 대상: ${rows.length}개 상품\n`);

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: null,
      args: [
        `--profile-directory=${PROFILE_DIR}`,
        '--no-default-browser-check',
        '--no-first-run',
        '--restore-last-session=false',
        '--window-position=-32000,-32000', // offscreen
        '--window-size=1400,900',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = (await context.pages())[0] ?? (await context.newPage());

    let ok = 0;
    let fail = 0;
    let empty = 0;

    for (let i = 0; i < rows.length; i++) {
      const p = rows[i]!;
      const label = `[${i + 1}/${rows.length}] ${p.code} ${p.name}`;
      try {
        const resp = await searchKeyword(page, p.name);
        if (!resp || !resp.data) {
          empty++;
          console.log(`  ⏭ ${label}: 응답 없음/null`);
        } else {
          const r = await updateProduct(p, resp);
          ok++;
          const grade =
            r.under300 >= 12 ? 'S' : r.under300 >= 6 ? 'A' : r.under300 >= 2 ? 'B' : 'C';
          console.log(
            `  ✅ ${label}: 네이버${r.monthly?.toLocaleString() ?? '-'}/월, 리뷰<300 ${r.under300}/${r.real} [${grade}], 로켓 ${r.rocket}`,
          );
        }
      } catch (e) {
        fail++;
        console.warn(
          `  ❌ ${label}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      // 다음 키워드까지 대기
      await new Promise((r) => setTimeout(r, BETWEEN_KEYWORD_MS));
    }

    console.log(`\n=== 결과 ===`);
    console.log(`  성공: ${ok}, 빈 응답: ${empty}, 실패: ${fail}`);
  } catch (e) {
    console.error('치명적:', e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
  process.exit(0);
})();
