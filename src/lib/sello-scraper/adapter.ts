/**
 * 셀록홈즈 스크래퍼 JSON → 정규화 타입 어댑터.
 *
 * BUYWISE(buywise-marketing-tool) 에서 이식.
 *   - sello-scraper 가 제공하는 필드만 변환한다. 모르는 값(평점 등)을
 *     더미 기본값으로 채우지 않는다.
 *   - 이커머스허브는 `data/sello-scrape/<키워드>.json` 을 primary 캐시로 삼고,
 *     metrics.ts 가 BUYWISE 경로도 fallback 으로 참조한다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  parseAmount,
  parseCount,
  parseInteger,
  parsePercent,
  parsePrice,
  parseRank,
} from './normalize';

/** scrape.ts 가 저장하는 원시 행 구조. */
export interface SelloScrapedRow {
  rank: string | null;
  coupangId: string | null;
  itemId: string | null;
  sourcingMonthlyAmount: string | null;
  name: string | null;
  price: string | null;
  review: string | null;
  pvMonth: string | null;
  sales: string | null;
  salesMonth: string | null;
  cvMonth: string | null;
  sourcingPrice: string | null;
  expectedAmount: string | null;
  expectedPriceRate: string | null;
  /** 신규 v2 필드. 구버전 파일에는 없을 수 있음(optional) — 없으면 adapter 가 null/false 로 fallback. */
  imageUrl?: string | null;
  productUrl?: string | null;
  isRocketDelivery?: boolean;
}

/** scrape.ts 가 저장하는 전체 JSON 파일 구조. */
export interface SelloScrapedJson {
  keyword: string;
  scrapedAt: string;
  url: string;
  rowCount: number;
  filledCount: number;
  rows: SelloScrapedRow[];
}

/**
 * sello 가 실제로 아는 정보만 정규화된 숫자로 담은 구조.
 */
export interface SelloProductMetrics {
  rank: number;
  coupangId: string | null;
  itemId: string | null;
  name: string;
  price: number | null;
  reviewCount: number | null;
  monthlyPv: number | null;
  monthlySales: number | null;
  monthlyRevenue: number | null;
  monthlyCvr: number | null;
  /** 원본 URL(a.href) 이 있으면 그것, 없으면 coupangId+itemId 로 재구성. 둘 다 없으면 null. */
  productUrl: string | null;
  /** 썸네일 이미지 URL. 없으면 null. */
  imageUrl: string | null;
  /** 로켓배송 여부. DOM 에서 li.del.rocket 존재 시 true. 구버전 JSON(필드 없음)은 false 로 보수적 처리. */
  isRocketDelivery: boolean;
}

/**
 * 한 행 변환. rank 또는 name 이 비어있으면 null 반환(유효 row 가 아님).
 */
export function adaptSelloRow(row: SelloScrapedRow): SelloProductMetrics | null {
  const rank = parseRank(row.rank);
  if (rank === null) return null;
  const name = (row.name ?? '').trim();
  if (!name) return null;

  const coupangId = row.coupangId?.trim() || null;
  const itemId = row.itemId?.trim() || null;

  // 우선순위: 스크랩된 원본 href (a.href) > coupangId+itemId 재구성 > null
  let productUrl: string | null = null;
  const rawHref = row.productUrl?.trim();
  if (rawHref) {
    productUrl = rawHref;
  } else if (coupangId) {
    productUrl = `https://www.coupang.com/vp/products/${coupangId}`;
    if (itemId) productUrl += `?itemId=${itemId}`;
  }

  const imageUrlRaw = row.imageUrl?.trim();
  const imageUrl = imageUrlRaw ? imageUrlRaw : null;

  return {
    rank,
    coupangId,
    itemId,
    name,
    price: parsePrice(row.price),
    reviewCount: parseInteger(row.review),
    monthlyPv: parseInteger(row.pvMonth),
    monthlySales: parseCount(row.sales),
    monthlyRevenue: parseAmount(row.salesMonth),
    monthlyCvr: parsePercent(row.cvMonth),
    productUrl,
    imageUrl,
    isRocketDelivery: row.isRocketDelivery === true,
  };
}

/**
 * 전체 JSON → 유효 행만 필터링한 배열. 입력이 비정상이면 빈 배열.
 */
export function adaptSelloJson(
  json: SelloScrapedJson | null | undefined,
): SelloProductMetrics[] {
  if (!json || !Array.isArray(json.rows)) return [];
  return json.rows
    .map(adaptSelloRow)
    .filter((m): m is SelloProductMetrics => m !== null);
}

/**
 * 디스크에서 `<baseDir>/<keyword>.json` 을 로드. 파일이 없거나
 * 파싱 실패하면 null.
 *
 * baseDir 기본값은 `process.cwd()/data/sello-scrape` — 이커머스허브 자체 캐시.
 * metrics.ts 에서 BUYWISE 공유 캐시를 두 번째 baseDir 로 넘겨 fallback 구현.
 */
export async function loadSelloScrape(
  keyword: string,
  baseDir?: string,
): Promise<SelloScrapedJson | null> {
  const dir = baseDir ?? path.join(process.cwd(), 'data', 'sello-scrape');
  const file = path.join(dir, `${keyword}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as SelloScrapedJson).rows)
    ) {
      return parsed as SelloScrapedJson;
    }
    return null;
  } catch {
    return null;
  }
}
