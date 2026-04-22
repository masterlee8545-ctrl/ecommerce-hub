/**
 * 셀록홈즈 캐시 기반 쿠팡 1페이지 지표 추출 (얇은 래퍼).
 *
 * 캐시 조회 순서 (두 경로 fallback):
 *   1) 이커머스허브 자체:  <cwd>/data/sello-scrape/<키워드>.json
 *   2) BUYWISE 공유:      C:\개발\buywise-marketing-tool\data\sello-scrape\<키워드>.json
 *
 * 양쪽 모두 없으면 `null`. 호출자는 `npm run sello:scrape -- <키워드>` 를
 * 사용자에게 안내하면 된다 (Windows 로컬에서만 동작, Chrome 창 뜸).
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시) — 모르는 값은 null/false 로 반환.
 */

import path from 'node:path';

import { adaptSelloJson, loadSelloScrape } from './adapter';
import { DEFAULT_CACHE_TTL_MS } from './constants';
import { parseInteger } from './normalize';

// Re-export for backwards compatibility (기존 import 위치 유지)
export { DEFAULT_CACHE_TTL_MS };

const HUB_CACHE = path.join(process.cwd(), 'data', 'sello-scrape');
const BUYWISE_CACHE = 'C:\\개발\\buywise-marketing-tool\\data\\sello-scrape';

export interface FirstPageReviewRow {
  rank: number;
  name: string;
  reviewCount: number;
  isRocket: boolean;
  /** 가격 (원) — 스크래퍼가 파싱한 값, 못 찾으면 null. */
  price: number | null;
  /** 썸네일 이미지 URL — 없으면 null. */
  imageUrl: string | null;
  /** 쿠팡 상품 상세 URL — 없으면 null. */
  productUrl: string | null;
  /** 월간 판매 수량 (셀록홈즈 추정) — 없으면 null. */
  monthlySales: number | null;
}

/** 1페이지 20개 가격 통계 (null 값은 분모에서 제외). */
export interface FirstPagePriceStats {
  min: number | null;
  median: number | null;
  max: number | null;
  avg: number | null;
  /** 가격이 있는 상품 수 */
  sampleSize: number;
}

export interface FirstPageMetrics {
  keyword: string;
  rowCount: number;
  /** 1페이지 로켓배송 비율 (0~1). 분모는 `rowCount`. */
  rocketRatio: number;
  reviews: FirstPageReviewRow[];
  /** 가격 통계 */
  priceStats: FirstPagePriceStats;
  /** 캐시 출처 — 디버깅/UI 표시용. */
  source: 'hub' | 'buywise';
  /** 원본 스크래핑 시각 (ISO 문자열) — 캐시 신선도 판단용 */
  scrapedAt: string;
  /** 캐시 나이 (ms) — 현재시각 기준 */
  cacheAgeMs: number;
  /** 캐시가 stale 인지 여부 (DEFAULT_CACHE_TTL_MS 초과) */
  isStale: boolean;
}

/** 두 캐시 경로에서 순차 조회. 둘 다 없으면 null. */
async function loadShared(
  keyword: string,
): Promise<{ json: NonNullable<Awaited<ReturnType<typeof loadSelloScrape>>>; source: 'hub' | 'buywise' } | null> {
  const hub = await loadSelloScrape(keyword, HUB_CACHE);
  if (hub) return { json: hub, source: 'hub' };
  const buywise = await loadSelloScrape(keyword, BUYWISE_CACHE);
  if (buywise) return { json: buywise, source: 'buywise' };
  return null;
}

/**
 * 가격 배열 → 최소/중앙/최대/평균.
 * null/NaN/음수 제외.
 */
function computePriceStats(prices: Array<number | null>): FirstPagePriceStats {
  const valid = prices
    .filter((p): p is number => p !== null && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    return { min: null, median: null, max: null, avg: null, sampleSize: 0 };
  }
  const min = valid[0] ?? null;
  const max = valid[valid.length - 1] ?? null;
  const sum = valid.reduce((s, v) => s + v, 0);
  const avg = Math.round(sum / valid.length);
  const mid = Math.floor(valid.length / 2);
  const median =
    valid.length % 2 === 0
      ? Math.round(((valid[mid - 1] ?? 0) + (valid[mid] ?? 0)) / 2)
      : valid[mid] ?? null;
  return { min, median, max, avg, sampleSize: valid.length };
}

/**
 * 키워드별 쿠팡 1페이지 지표 — 리뷰수·로켓비율·가격·썸네일·URL 포함.
 *
 * 캐시가 없으면 `null`. 스크래핑을 트리거하지는 않는다 (별도 스크립트).
 */
export async function getCoupangFirstPageMetrics(
  keyword: string,
): Promise<FirstPageMetrics | null> {
  const hit = await loadShared(keyword);
  if (!hit) return null;

  const { json, source } = hit;
  // adapter 로 한 번 정규화 → price/imageUrl/productUrl 재구성 로직 재사용
  const metrics = adaptSelloJson(json);
  const rowCount = metrics.length || json.rows.length;
  const denom = Math.max(rowCount, 1);
  const rocketCount = metrics.filter((m) => m.isRocketDelivery).length;
  const rocketRatio = rocketCount / denom;

  const reviews: FirstPageReviewRow[] = metrics.map((m) => ({
    rank: m.rank,
    name: m.name,
    reviewCount: m.reviewCount ?? parseInteger(m.reviewCount ? String(m.reviewCount) : null) ?? 0,
    isRocket: m.isRocketDelivery,
    price: m.price,
    imageUrl: m.imageUrl,
    productUrl: m.productUrl,
    monthlySales: m.monthlySales,
  }));

  const priceStats = computePriceStats(reviews.map((r) => r.price));

  // 캐시 나이 계산
  const scrapedAt = json.scrapedAt ?? new Date().toISOString();
  const scrapedTimeMs = new Date(scrapedAt).getTime();
  const cacheAgeMs = Number.isFinite(scrapedTimeMs)
    ? Math.max(0, Date.now() - scrapedTimeMs)
    : 0;
  const isStale = cacheAgeMs > DEFAULT_CACHE_TTL_MS;

  return {
    keyword,
    rowCount,
    rocketRatio,
    reviews,
    priceStats,
    source,
    scrapedAt,
    cacheAgeMs,
    isStale,
  };
}
