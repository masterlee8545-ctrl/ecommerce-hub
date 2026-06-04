/**
 * 네이버 검색 API 클라이언트 (블로그/카페/지식인/지역)
 *
 * 출처: https://developers.naver.com/docs/serviceapi/search/blog/blog.md
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-7 (시크릿 .env.local)
 * ADR: 2.5번 PR (외부 공급처 서칭)
 *
 * 인증:
 *   X-Naver-Client-Id: $NAVER_SEARCH_CLIENT_ID
 *   X-Naver-Client-Secret: $NAVER_SEARCH_CLIENT_SECRET
 *
 * 한도: 일 25,000회 무료
 */

const NAVER_OPEN_API = 'https://openapi.naver.com/v1/search';

export type NaverSearchType = 'blog' | 'cafearticle' | 'kin' | 'shop' | 'local';

export interface NaverSearchItem {
  title: string;
  link: string;
  description: string;
  /** 블로그/카페 */
  bloggername?: string;
  postdate?: string;
  /** 지역 */
  address?: string;
  roadAddress?: string;
  telephone?: string;
  category?: string;
  /** 쇼핑 */
  mallName?: string;
  productId?: string;
  lprice?: string;
  hprice?: string;
}

export interface NaverSearchResponse {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverSearchItem[];
}

export interface NaverSearchOptions {
  query: string;
  type: NaverSearchType;
  display?: number; //                기본 10, 최대 100
  start?: number; //                  기본 1, 최대 1000
  sort?: 'sim' | 'date'; //           유사도 / 날짜
}

function stripHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function naverSearch(opts: NaverSearchOptions): Promise<NaverSearchResponse> {
  const clientId = process.env['NAVER_SEARCH_CLIENT_ID'];
  const clientSecret = process.env['NAVER_SEARCH_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    throw new Error('NAVER_SEARCH_CLIENT_ID / SECRET 환경변수가 설정되지 않았습니다.');
  }

  const params = new URLSearchParams({
    query: opts.query,
    display: String(opts.display ?? 10),
    start: String(opts.start ?? 1),
    sort: opts.sort ?? 'sim',
  });

  const url = `${NAVER_OPEN_API}/${opts.type}.json?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 검색 API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as NaverSearchResponse;

  // HTML 태그 제거
  json.items = json.items.map((it) => ({
    ...it,
    title: stripHtml(it.title),
    description: stripHtml(it.description),
  }));

  return json;
}

/**
 * 한 쿼리로 여러 소스 동시 검색 (블로그 + 지식인 + 지역).
 */
export async function naverMultiSearch(
  query: string,
  types: NaverSearchType[] = ['blog', 'kin'],
): Promise<Record<NaverSearchType, NaverSearchResponse | { error: string }>> {
  const results = await Promise.allSettled(
    types.map((type) => naverSearch({ query, type, display: 10 })),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  types.forEach((type, i) => {
    const r = results[i];
    if (r && r.status === 'fulfilled') out[type] = r.value;
    else out[type] = { error: r?.status === 'rejected' ? String(r.reason) : 'unknown' };
  });
  return out;
}
