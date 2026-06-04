/**
 * 네이버 쇼핑 검색 API — 상위 10개 가격 통계
 *
 * 출처: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
 * 헌법: CLAUDE.md §1 P-3 (estimated)
 *
 * 가격: lprice (low) ~ hprice (high). hprice 가 비어있을 수 있음.
 */
import { naverSearch } from './naver-search';

export interface NaverShopListing {
  rank: number;
  title: string;
  price: number;
  mall: string | null;
  link: string;
  productId: string | null;
}

export interface NaverShopPriceStats {
  min: number | null;
  median: number | null;
  max: number | null;
  sampleSize: number;
  /** 상위 N개 상품명+가격+URL+몰명 */
  listings: NaverShopListing[];
}

export async function getNaverShopPriceStats(
  keyword: string,
  sampleSize = 10,
): Promise<NaverShopPriceStats> {
  const res = await naverSearch({ query: keyword, type: 'shop', display: sampleSize, sort: 'sim' });

  const listings: NaverShopListing[] = [];
  const prices: number[] = [];

  res.items.forEach((item, idx) => {
    const lp = Number(item.lprice);
    if (!Number.isFinite(lp) || lp <= 0) return;
    prices.push(lp);
    listings.push({
      rank: idx + 1,
      title: item.title ?? '',
      price: lp,
      mall: item.mallName ?? null,
      link: item.link ?? '',
      productId: item.productId ?? null,
    });
  });

  if (prices.length === 0) {
    return { min: null, median: null, max: null, sampleSize: 0, listings: [] };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;

  return {
    min: sorted[0] ?? null,
    median,
    max: sorted[sorted.length - 1] ?? null,
    sampleSize: prices.length,
    listings,
  };
}
