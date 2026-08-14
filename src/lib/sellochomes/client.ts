/**
 * 셀록홈즈 (sellochomes.co.kr) sellerlife API 클라이언트
 *
 * 역할:
 * - 카테고리 트리 조회 (대분류 → 중분류 → 소분류 → 4차분류)
 * - 카테고리별 키워드 리스트 (페이지네이션)
 * - 네이버 검색량 + 쿠팡 리뷰 + 경쟁률 통합 데이터
 *
 * 인증: connect.sid 쿠키 (사용자 세션). 만료되면 `/settings` 에서 재입력.
 *
 * ADR: docs/ADR-014.md — 자격증명 금고 + 응답 계약 + 공통 fetch
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 명시 에러), §1 P-7
 *
 * 쿠키 보관은 금고(`@/lib/crawl` vault)가 맡는다:
 *   메모리 → DB(system_settings) → 파일(.data) → 환경변수
 * (Vercel 은 인스턴스가 여러 개라 메모리·파일은 인스턴스마다 따로 논다. DB 가 유일한 공유처다.)
 *
 * HTTP 호출은 전부 `crawlFetchJson` 한 경로를 지난다. 예전에는 이 파일 안에
 * fetch 블록이 다섯 군데 흩어져 있었고 User-Agent 가 Chrome 147/149 로 서로
 * 달랐다. 이제 헤더·타임아웃·재시도·응답 계약이 한 곳에서 정해진다.
 *
 * 핵심 API:
 * - moveCategoryPage: wholeCategoryName(한글 경로) → queryCategoryId + 카테고리 트리
 * - items: categoryId + page → 40개 키워드 배열 (discoveryCnt 로 총 개수)
 */
import { isCrawlError } from '@/lib/crawl/errors';
import { buildCookieHeader, crawlFetchJson, type HeaderProfile } from '@/lib/crawl/fetch';
import {
  clearCredentialCache,
  CredentialMissingError,
  getCredential,
  hasCredential,
  saveCredential,
} from '@/lib/crawl/vault';

const BASE_URL = 'https://sellochomes.co.kr/api/v1/sellerlife';
const ORIGIN = 'https://sellochomes.co.kr';
const DEFAULT_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────
// 타입 — 실제 응답 구조
// ─────────────────────────────────────────────────────────

export interface SCTreeNode {
  name: string;
  cate_id: string;
}

export interface SCTreeLevel {
  reps: string;
  catelist: SCTreeNode[];
}

export interface SCCategoryTreeResponse {
  _result: number;
  _desc: string;
  queryCategoryId: string;
  setCategory_Info: {
    [level: string]: SCTreeLevel;
  };
}

/**
 * 카테고리 items 응답의 개별 키워드.
 * 중요 필드만 타입 지정 — 전체 60+ 필드 중 실제로 쓰는 것들.
 */
export interface SCKeyword {
  keyword: string;
  wholeCategoryName: string;
  totalItemCounts: number;
  avgPrice: number | null;

  /** 쿠팡 */
  c_pCnt: number; //              쿠팡 상품수
  c_avgPrice: number | null; //   쿠팡 평균가
  c_avgReviewCnt: number; //      쿠팡 평균 리뷰수 (핵심 필터)
  c_maxReviewCnt: number; //      쿠팡 최대 리뷰수
  c_totalReviewCnt: number; //    쿠팡 총 리뷰수
  c_rocketRatio: number; //       쿠팡 로켓배송 비율 (0~1)
  c_jetRatio: number; //          쿠팡 제트배송 비율
  c_ovsRatio: number; //          쿠팡 해외 상품 비율

  /** 경쟁 & 검색량 */
  competition: number; //         경쟁률 (숫자)
  compIdx: string | null; //      경쟁 지수 (낮음/보통/높음)
  monthlyQcCnt: number; //        월간 검색량
  threeMonthsQcCnt: number; //    3개월 검색량
  estimatedQcCnt: number; //      예상 월간 검색량
  threeMonthsEstimatedQcCnt: number; //  예상 3개월 검색량
  totalSearchCounts_lastyear: number; // 작년 총 검색량
  maxMonth: string; //            최대검색월
  maxMonth_qc: number; //         해당월 검색량

  /** 계절성 / 분류 */
  saturation: unknown | null;
  regression_cor_coef: number | null;
  seasonality: string; //         계절성 (있음/없음)
  seasonal_months: string;
  isBrandKey: number; //          브랜드 키워드 여부
  isCommerceKey: number; //       쇼핑성 키워드 여부
  newkeyword_1week: number; //    1주 내 신규 진입
}

export interface SCItemsResponse {
  _result: number;
  _desc: string;
  discoveryCnt: number; //        총 키워드 수 (페이지네이션용)
  discoveryData: SCKeyword[];
  isMembershipUser: boolean;
}

// ─────────────────────────────────────────────────────────
// 에러
// ─────────────────────────────────────────────────────────

export class SellochomesError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no_cookie'
      | 'auth_expired'
      | 'network'
      | 'bad_response'
      /** 응답이 왔는데 우리가 아는 모양이 아님 — 사이트가 바뀌었다는 신호 (ADR-014) */
      | 'schema_mismatch'
      | 'rate_limited'
      | 'category_not_found',
  ) {
    super(message);
    this.name = 'SellochomesError';
  }
}

/**
 * 공통 fetch 의 실패를 이 모듈의 공개 에러 타입으로 옮긴다.
 *
 * 호출부 여덟 곳이 `err instanceof SellochomesError && err.code === 'auth_expired'`
 * 를 보고 동작을 나눈다. 그 계약을 깨지 않으려고 번역만 한다.
 */
function toSellochomesError(err: unknown): SellochomesError {
  if (err instanceof SellochomesError) return err;
  // 쿠키가 아예 없는 상태를 network 로 뭉개면 /settings 로 유도하는 401 분기가 죽는다.
  // 금고가 던지는 전용 에러를 먼저 잡아야 한다.
  if (err instanceof CredentialMissingError) {
    return new SellochomesError(
      '셀록홈즈 쿠키가 설정되지 않았습니다. 설정 → 셀록홈즈 연결에서 쿠키를 입력하세요.',
      'no_cookie',
    );
  }
  if (!isCrawlError(err)) {
    return new SellochomesError(
      `셀록홈즈 호출 실패: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  }
  switch (err.code) {
    case 'session_expired':
      return new SellochomesError(
        '셀록홈즈 세션이 만료됐습니다. 설정에서 쿠키를 재발급하세요.',
        'auth_expired',
      );
    case 'no_credential':
      return new SellochomesError(err.message, 'no_cookie');
    case 'rate_limited':
      return new SellochomesError(
        '셀록홈즈 호출 한도에 걸렸습니다. 잠시 후 다시 시도하세요.',
        'rate_limited',
      );
    case 'schema_mismatch':
      return new SellochomesError(
        `셀록홈즈 응답 구조가 우리가 아는 것과 다릅니다: ${err.reason ?? '사유 미상'}`,
        'schema_mismatch',
      );
    case 'timeout':
    case 'network':
      return new SellochomesError(err.message, 'network');
    case 'contract_failed':
    case 'upstream_error':
      return new SellochomesError(err.message, 'bad_response');
  }
}

// ─────────────────────────────────────────────────────────
// 쿠키 (금고 위임)
// ─────────────────────────────────────────────────────────

/** 세션 쿠키 값. 없으면 던진다. */
async function getCookieValue(): Promise<string> {
  try {
    return await getCredential('sellochomes_cookie');
  } catch (err) {
    throw toSellochomesError(err);
  }
}

/**
 * 쿠키를 저장한다 (DB 우선 + 메모리 캐시 + 파일 best-effort).
 *
 * DB 저장이 실패하면 던진다 — Vercel 다중 인스턴스에서는 DB 가 유일한 공유처라,
 * 여기서 실패한 걸 삼키면 사용자는 "저장했다"고 믿는데 다른 인스턴스는 옛 값을 쓴다.
 */
export async function saveSellochomesCookie(cookie: string): Promise<void> {
  try {
    await saveCredential('sellochomes_cookie', cookie);
  } catch (err) {
    throw new SellochomesError(
      `쿠키 저장 실패: ${err instanceof Error ? err.message : String(err)}. ` +
        '마이그레이션(0008_system_settings) 적용 여부를 확인하세요.',
      'bad_response',
    );
  }
}

/** 쿠키 설정 여부 확인 (/settings 상태 표시용). */
export async function hasSellochomesCookie(): Promise<boolean> {
  return hasCredential('sellochomes_cookie');
}

/** 소싱 API 용 Cookie 헤더 — 세션 쿠키만 (기존 동작 유지). */
async function getSessionCookieHeader(): Promise<string> {
  return `connect.sid=${await getCookieValue()}`;
}

/**
 * 키워드 분석 API 용 Cookie 헤더 — 동반 쿠키까지.
 *
 * `sourcinglife_visitor_id` 와 `_ga` 가 없으면 백엔드가 502 "쿠팡 응답이 없습니다" 를 준다.
 * 예전에는 이 값들이 소스에 상수로 박혀 있었다. 이제 금고에서 오고, 값을 바꾸고
 * 싶으면 환경변수나 DB 로 덮을 수 있다 (기본값은 이전과 동일).
 */
async function getBrowserCookieHeader(): Promise<string> {
  const [sid, visitorId, ga] = await Promise.all([
    getCookieValue(),
    getCredential('sellochomes_visitor_id'),
    getCredential('sellochomes_ga'),
  ]);
  return buildCookieHeader({
    _ga: ga,
    sourcinglife_visitor_id: visitorId,
    'connect.sid': sid,
  });
}

// ─────────────────────────────────────────────────────────
// 공통 호출
// ─────────────────────────────────────────────────────────

/**
 * 화면 성격별 헤더 프로필.
 *
 * Referer/Origin 이 어긋나면 내부 API 가 요청을 거부한다. 호출부마다 손으로
 * 적으면 반드시 어긋나므로 여기 한 곳에 묶어 둔다.
 */
const SOURCING_PROFILE: HeaderProfile = {
  // 소싱 API 는 예전부터 Origin 없이 Referer 만 보내 왔다. 동작이 검증된 조합이라 유지한다.
  origin: null,
  referer: `${ORIGIN}/sellerlife/sourcing/category/`,
  json: false,
  xhr: true,
};

function keywordProfile(keyword: string): HeaderProfile {
  return {
    origin: ORIGIN,
    referer: `${ORIGIN}/sellerlife/coupang-analysis-keyword/?keyword=${encodeURIComponent(keyword)}&page=1`,
    json: true,
    xhr: false,
  };
}

const KEYWORD_ANALYSIS_PROFILE: HeaderProfile = {
  origin: ORIGIN,
  referer: `${ORIGIN}/sellerlife/keyword-analysis/`,
  json: true,
  xhr: false,
};

/**
 * 공통 fetch 의 실패를 이 모듈 에러로 옮기고, 세션이 끊겼으면 금고 캐시를 비운다.
 * 캐시를 비워야 사용자가 새 쿠키를 넣은 직후부터 반영된다.
 */
function handleFetchError(err: unknown): never {
  if (isCrawlError(err) && err.code === 'session_expired') {
    clearCredentialCache('sellochomes_cookie');
  }
  throw toSellochomesError(err);
}

/** 소싱 API 호출. `contractId` 로 응답 모양까지 검증한다. */
async function fetchSC<T>(
  path: string,
  contractId: string,
  search?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (search) {
    for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  }
  const cookie = await getSessionCookieHeader();
  try {
    return await crawlFetchJson<T>(url.toString(), {
      source: 'sellochomes',
      endpoint: path,
      profile: SOURCING_PROFILE,
      cookie,
      contractId,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return handleFetchError(err);
  }
}

// ─────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────

/**
 * 카테고리 경로(예: "식품>농산물>과일") → 카테고리 ID + 전체 트리.
 * 빈 문자열이나 최상위 대분류만 넘기면 대분류만 포함된 트리 반환.
 */
export async function resolveCategoryPath(
  wholeCategoryName: string,
): Promise<SCCategoryTreeResponse> {
  const res = await fetchSC<SCCategoryTreeResponse>(
    '/sourcing/include/moveCategoryPage',
    'sellochomes.category_tree',
    { wholeCategoryName },
  );
  if (res._result !== 1) {
    throw new SellochomesError(
      `카테고리 확인 실패: ${res._desc || 'unknown'}`,
      'category_not_found',
    );
  }
  return res;
}

/**
 * 카테고리 키워드 한 페이지(40개) 조회.
 * - categoryId: 예) "50000960" (식품>농산물>과일)
 * - sort: "-1" 기본값 (검색량 내림차순 등, 셀록 기본 정렬)
 */
export async function fetchCategoryItems(
  categoryId: string,
  options?: { page?: number; sort?: string; column?: string },
): Promise<SCItemsResponse> {
  const page = options?.page ?? 1;
  const res = await fetchSC<SCItemsResponse>(
    '/sourcing/category/items',
    'sellochomes.category_items',
    {
      category: categoryId,
      page: String(page),
      first: page === 1 ? 'true' : 'false',
      sort: options?.sort ?? '-1',
      column: options?.column ?? '',
    },
  );
  return res;
}

/** 한 번에 긁을 페이지 수 안전 상한 (기본값). */
const DEFAULT_MAX_PAGES = 15;

/** 카테고리 전체 키워드 수집 결과 — 얼마나 못 가져왔는지까지 함께 준다. */
export interface CategoryKeywordHarvest {
  keywords: SCKeyword[];
  /** 셀록홈즈가 알려 준 총 개수 */
  expected: number;
  /** 기대치를 다 채웠는가 */
  complete: boolean;
  /**
   * 덜 가져왔다면 그 이유.
   * - `max_pages` 우리가 건 상한에 걸림 (의도된 절단)
   * - `empty_page` 중간에 빈 페이지가 나와 멈춤 (예상 밖 — 확인 필요)
   */
  truncatedBy: 'max_pages' | 'empty_page' | null;
}

/**
 * 카테고리 전체 키워드(여러 페이지) 수집 — 완결 여부까지 돌려준다.
 *
 * 예전에는 빈 페이지가 나오면 조용히 멈추고 "수집 완료"처럼 배열만 돌려줬다.
 * 절단된 결과와 진짜 전부를 구분할 수 없으면, 아래 단계의 분석이 부분 데이터를
 * 전체로 착각한다 (P-1).
 */
export async function harvestCategoryKeywords(
  categoryId: string,
  options?: { maxPages?: number },
): Promise<CategoryKeywordHarvest> {
  const first = await fetchCategoryItems(categoryId, { page: 1 });
  const expected = first.discoveryCnt;
  const pageSize = first.discoveryData.length; // 보통 40
  if (pageSize === 0) {
    return { keywords: [], expected, complete: expected === 0, truncatedBy: null };
  }

  const totalPages = Math.ceil(expected / pageSize);
  const pageCap = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const maxPages = Math.min(totalPages, pageCap);

  const keywords: SCKeyword[] = [...first.discoveryData];
  let truncatedBy: 'max_pages' | 'empty_page' | null = totalPages > pageCap ? 'max_pages' : null;

  for (let p = 2; p <= maxPages; p += 1) {
    const next = await fetchCategoryItems(categoryId, { page: p });
    if (next.discoveryData.length === 0) {
      truncatedBy = 'empty_page';
      break;
    }
    keywords.push(...next.discoveryData);
  }

  return {
    keywords,
    expected,
    complete: truncatedBy === null && keywords.length >= expected,
    truncatedBy,
  };
}

/**
 * 카테고리 전체 키워드 배열.
 *
 * 기존 호출부를 위한 얇은 래퍼다. 덜 가져왔으면 경고를 남긴다 —
 * 완결 여부까지 필요한 곳은 `harvestCategoryKeywords` 를 직접 쓴다.
 */
export async function fetchAllCategoryKeywords(
  categoryId: string,
  options?: { maxPages?: number },
): Promise<SCKeyword[]> {
  const harvest = await harvestCategoryKeywords(categoryId, options);
  if (!harvest.complete) {
    console.warn(
      `[sellochomes] 카테고리 ${categoryId} 키워드를 다 못 가져왔습니다: ` +
        `${harvest.keywords.length}/${harvest.expected}건 (사유: ${harvest.truncatedBy ?? '개수 불일치'})`,
    );
  }
  return harvest.keywords;
}

// ─────────────────────────────────────────────────────────
// keyword-caching/recent — 셀록홈즈 새 통합 endpoint (2026~)
// ─────────────────────────────────────────────────────────
//
// 기존 coupangKeywordInfo 는 deprecate 됨 (502 던짐).
// 신규 endpoint 는 한 번의 POST 로 네이버 검색량 + 쿠팡 1페이지 + 연관 키워드 다 줌.
//
// 호출 패턴:
//   POST /api/v1/keyword-caching/recent
//   body: [{ category: 'coupang-analysis-keyword', keyword, startDate, endDate }]
//   - startDate/endDate: 'YYYYMMDD' (어제 ~ 오늘 권장; 셀록홈즈가 캐시 윈도우로 사용)
//
// 추가 필수 쿠키 (connect.sid 외):
//   sourcinglife_visitor_id, _ga, _ga_*
// 없으면 백엔드가 502 "쿠팡 응답이 없습니다" 던짐.

const KEYWORD_CACHING_URL = 'https://sellochomes.co.kr/api/v1/keyword-caching/recent';
// search = fresh 쿠팡 검색 트리거. 캐시 없는 키워드도 이걸 먼저 부르면
// 셀록홈즈가 쿠팡 검색을 새로 시작 → recent 폴링으로 shoppingList 받아짐.
// (형 화면이 검색 시 실제로 호출하는 endpoint — 2026-06 발견)
const KEYWORD_SEARCH_URL = 'https://sellochomes.co.kr/api/v1/sellerlife/keyword-analysis/search';
const CACHING_POLL_ATTEMPTS = 10;
const CACHING_POLL_INTERVAL_MS = 1_500;

/** 셀록홈즈 화면 1~20등(+α) 한 상품 row */
export interface SCShoppingListItem {
  url: string;
  isAd: boolean;
  isPb: boolean;
  rank: number;
  price: number;
  title: string;
  itemid: string;
  prdImg: string;
  coupangId: string;
  reviewCnt: number;
  hasBrandTag: boolean;
  discountRate: number | null;
  discountPrice: number | null;
  originalPrice: number | null;
  /** 'rocket' | 'merchant' | 'domestic' | 'foreign' */
  shippingMethod: string;
  /** '로켓배송' | '판매자로켓' | '국내배송' | '해외배송' */
  koShippingMethod: string;
}

export interface SCKeywordCachingItem {
  id: number;
  category: string;
  keyword: string;
  data: {
    naver: {
      monthlyQcCnt?: number;
      totalSearchCounts_lastyear?: number;
      chartData?: unknown;
    };
    coupang: {
      totalCnt: number;
      avgPrice: number;
      avgReviewCnt: string; // 문자열로 옴
      maxReviewCnt: number;
      rocketCnt: number;
      rocketRatio: number; // 0~100 (%)
      pbRatio: number;
      ovsRatio: number;
      ovsCnt: number;
      shoppingList: SCShoppingListItem[];
      keyword?: {
        popular?: Array<{ keyword: string; totalcnt: string }>;
        related?: string[];
        category?: string[];
        autocomplete?: string[];
      };
      top1ReviewRatio?: number;
      top3ReviewRatio?: number;
      merchantRocketCnt?: number;
      merchantRocketReviewCnt?: number;
      rocketReviewCnt?: number;
    };
  };
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * search endpoint — fresh 쿠팡 검색 트리거.
 * 캐시 없는 키워드는 이걸 먼저 불러야 셀록홈즈가 쿠팡 검색을 시작한다.
 * 응답엔 네이버 검색량/연간 추이가 있지만 쿠팡 shoppingList 는 비동기 (recent 로 폴링).
 *
 * 트리거 실패는 치명적이지 않다 — 캐시가 이미 있으면 폴링만으로 성공할 수 있다.
 * 다만 세션 만료는 폴링해도 못 푸는 문제라 그대로 올려 보낸다.
 */
async function triggerKeywordSearch(keyword: string, cookie: string): Promise<void> {
  try {
    // 응답 본문은 쓰지 않는다 (트리거 목적). 계약도 걸지 않는다.
    await crawlFetchJson<unknown>(
      `${KEYWORD_SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`,
      {
        source: 'sellochomes',
        endpoint: 'keyword-analysis/search',
        profile: keywordProfile(keyword),
        cookie,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        retries: 0,
      },
    );
  } catch (err) {
    if (isCrawlError(err) && err.code === 'session_expired') {
      clearCredentialCache('sellochomes_cookie');
      throw toSellochomesError(err);
    }
    // 그 밖의 실패는 넘어간다 — 아래 폴링이 캐시로 성공할 수 있다
  }
}

/** 하루를 밀리초로 — recent 호출의 캐시 윈도우 계산에 쓴다. */
const ONE_DAY_MS = 86_400_000;

/** recent 단발 호출 — 캐시된 데이터 있으면 반환, 없으면 null */
async function fetchCachingOnce(
  keyword: string,
  cookie: string,
): Promise<SCKeywordCachingItem | null> {
  const today = new Date();
  const yesterday = new Date(today.getTime() - ONE_DAY_MS);
  const body = JSON.stringify([
    {
      category: 'coupang-analysis-keyword',
      keyword,
      startDate: yyyymmdd(yesterday),
      endDate: yyyymmdd(today),
    },
  ]);

  let arr: Array<SCKeywordCachingItem | null>;
  try {
    arr = await crawlFetchJson<Array<SCKeywordCachingItem | null>>(KEYWORD_CACHING_URL, {
      source: 'sellochomes',
      endpoint: 'keyword-caching/recent',
      profile: keywordProfile(keyword),
      method: 'POST',
      cookie,
      body,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return handleFetchError(err);
  }

  // 최상위가 배열이 아니면 응답 구조가 바뀐 것이다 — "아직 준비 안 됨"과 다르다.
  if (!Array.isArray(arr)) {
    throw new SellochomesError(
      'keyword-caching 응답이 배열이 아닙니다 (응답 구조 변경 가능).',
      'schema_mismatch',
    );
  }

  const first = arr[0];
  // 여기서의 null 은 "셀록홈즈가 아직 쿠팡 검색을 끝내지 못함" 이라는 정상 상태다.
  // 호출부가 폴링으로 기다린다.
  if (!first || !first.data || !first.data.coupang?.shoppingList?.length) {
    return null;
  }
  return first;
}

/**
 * 키워드 분석 데이터 가져오기 (트리거 → 폴링).
 *
 * 1) search endpoint 로 쿠팡 검색 트리거 (캐시 없어도 새로 검색 시작)
 * 2) recent 를 1.5초 간격으로 폴링 — shoppingList 채워지면 반환
 *
 * 형 화면에서 검색하는 것과 동일 동작 → 사전 수동 검색 불필요.
 * 키워드당 ~2~5초 (캐시 hit 면 1초).
 */
export async function fetchKeywordCaching(
  keyword: string,
): Promise<SCKeywordCachingItem> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new SellochomesError('키워드가 비어있습니다.', 'bad_response');
  }
  // 동반 쿠키까지 붙인다 — 없으면 백엔드가 쿠팡 응답을 돌려주지 않는다
  const cookie = await getBrowserCookieHeader();

  // 0) 캐시 즉시 hit 시도 (이미 받아본 키워드면 트리거 생략)
  const cached = await fetchCachingOnce(trimmed, cookie);
  if (cached) return cached;

  // 1) 검색 트리거
  await triggerKeywordSearch(trimmed, cookie);

  // 2) 폴링
  for (let i = 0; i < CACHING_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, CACHING_POLL_INTERVAL_MS));
    const item = await fetchCachingOnce(trimmed, cookie);
    if (item) return item;
  }

  throw new SellochomesError(
    `keyword-caching 데이터 없음 (트리거 후 ${(CACHING_POLL_ATTEMPTS * CACHING_POLL_INTERVAL_MS) / 1000}초 폴링 실패 — 셀록홈즈 응답 지연)`,
    'bad_response',
  );
}

/** keyword-caching 화면 기준 리뷰 임계값 (셀록홈즈 화면과 같은 값). */
const CACHING_REVIEW_THRESHOLD = 300;
/** 그 임계값 미만 상품이 이만큼 있으면 "진입 가능" 으로 본다. */
const CACHING_MAJORITY_COUNT = 12;

/**
 * shoppingList 에서 리뷰 분포 분석.
 * 광고/PB 제외, 리뷰 < threshold 인 개수 카운트.
 */
export function analyzeKeywordCaching(
  item: SCKeywordCachingItem,
  options?: { threshold?: number; majorityCount?: number },
): ReviewDistribution {
  const threshold = options?.threshold ?? CACHING_REVIEW_THRESHOLD;
  const majorityCount = options?.majorityCount ?? CACHING_MAJORITY_COUNT;
  const list = item.data.coupang.shoppingList ?? [];
  const real = list.filter((it) => !it.isAd && !it.isPb);
  const reviewCounts = real.map((it) => it.reviewCnt);
  const under = reviewCounts.filter((r) => r < threshold).length;
  return {
    keyword: item.keyword,
    totalProducts: list.length,
    realProducts: real.length,
    underThresholdCount: under,
    underThresholdRatio: real.length > 0 ? under / real.length : 0,
    isMajority: under >= majorityCount,
    threshold,
    majorityCount,
    reviewCounts,
  };
}

// ─────────────────────────────────────────────────────────
// 쿠팡 키워드 1페이지 상품 분석 (LEGACY — deprecate 됨, 502)
// ─────────────────────────────────────────────────────────

const KEYWORD_INFO_BASE = 'https://sellochomes.co.kr/api/v1/sellerlife/keyword-analysis/coupang-keyword';

export interface CoupangKeywordItem {
  url: string;
  isAd: boolean;
  isPb: boolean;
  rank: number | null;
  price: number | null;
  title: string;
  itemid: string;
  prdImg: string;
  coupangId: string;
  reviewCnt: number;
  hasBrandTag: unknown | null;
  discountRate: number | null;
  /** 셀러라이프 확장이 채우는 데이터 — 이 API 응답에선 null */
  monthlySales: unknown | null;
  /** 셀러라이프 확장이 채우는 데이터 — 이 API 응답에선 null */
  monthlyViews: unknown | null;
  discountPrice: number | null;
  /** 셀러라이프 확장이 채우는 데이터 — 이 API 응답에선 null */
  monthlyAmount: unknown | null;
  /** 셀러라이프 확장이 채우는 데이터 — 이 API 응답에선 null */
  monthlyCvRate: unknown | null;
  originalPrice: number | null;
  /** 'rocket' | 'merchant' | 'domestic' | 'foreign' | ... */
  shippingMethod: string;
  /** '로켓배송' | '판매자로켓' | '국내배송' | '해외배송' */
  koShippingMethod: string;
  hasRecommendedTag: unknown | null;
  expectedShippingDate: number;
}

export interface CoupangKeywordInfoResponse {
  success: boolean;
  data: {
    _result: boolean;
    page: number;
    pageKey: string;
    /** 응답에 포함된 상품 수 (광고 포함) */
    totalProducts: number;
    /** 쿠팡 검색 결과 전체 수 */
    totalCnt: number;
    items: CoupangKeywordItem[];
  };
}

/**
 * 키워드 1페이지 상품 정보 직접 조회 (~1초/키워드).
 *
 * Chrome/Playwright 안 쓰고 셀록홈즈 자체 API 직접 호출.
 * 사용량 1회 차감 (사장님 구독 한도 내).
 */
export async function fetchCoupangKeywordInfo(
  keyword: string,
  page = 1,
): Promise<CoupangKeywordInfoResponse> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new SellochomesError('키워드가 비어있습니다.', 'bad_response');
  }

  const url = new URL(`${KEYWORD_INFO_BASE}/coupangKeywordInfo`);
  url.searchParams.set('keyword', trimmed);
  url.searchParams.set('page', String(page));

  const cookie = await getSessionCookieHeader();

  let body: CoupangKeywordInfoResponse;
  try {
    body = await crawlFetchJson<CoupangKeywordInfoResponse>(url.toString(), {
      source: 'sellochomes',
      endpoint: 'keyword-analysis/coupangKeywordInfo',
      profile: {
        origin: null,
        referer: `${ORIGIN}/sellerlife/coupang-analysis-keyword/`,
        json: false,
        xhr: false,
      },
      cookie,
      contractId: 'sellochomes.keyword_info',
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return handleFetchError(err);
  }

  if (!body.success || !body.data) {
    throw new SellochomesError('셀록홈즈 키워드 분석 응답이 비정상입니다.', 'bad_response');
  }
  // 이후 분석이 `data.items` 를 가드 없이 훑으므로 여기서 모양을 확정해 둔다.
  if (!Array.isArray(body.data.items)) {
    throw new SellochomesError(
      '셀록홈즈 키워드 분석 응답에 상품 목록(items)이 없습니다 (응답 구조 변경 가능).',
      'schema_mismatch',
    );
  }
  return body;
}

// ─────────────────────────────────────────────────────────
// 리뷰 분포 분석 (사장님 핵심 use case)
// ─────────────────────────────────────────────────────────

/**
 * 사장님 기본 기준: 리뷰 500미만이 10개 이상이면 진입 가능 시장.
 *  - threshold(=500): 리뷰 미만 기준
 *  - majorityCount(=10): 그 이상이어야 "진입 가능" 으로 판단
 */
export interface ReviewDistribution {
  keyword: string;
  /** API 응답 전체 상품 수 (광고 포함) */
  totalProducts: number;
  /** 광고/PB 제외한 일반 상품 수 (분석 대상) */
  realProducts: number;
  /** 일반 상품 중 리뷰 < threshold 인 개수 */
  underThresholdCount: number;
  /** underThresholdCount / realProducts (0~1) */
  underThresholdRatio: number;
  /** underThresholdCount >= majorityCount 면 true (= "진입 가능" 시장) */
  isMajority: boolean;
  /** 사용한 임계값 — UI 표시용 */
  threshold: number;
  /** 사용한 majority 기준 — UI 표시용 */
  majorityCount: number;
  /** 디버깅용 — 일반 상품들의 리뷰 수 배열 */
  reviewCounts: number[];
}

/** 사장님 기본 기준: 리뷰 500 미만. */
const DEFAULT_REVIEW_THRESHOLD = 500;
/** 그 기준 미만 상품이 10개 이상이면 "진입 가능" 시장으로 본다. */
const DEFAULT_MAJORITY_COUNT = 10;

/**
 * fetchCoupangKeywordInfo 응답에서 리뷰 분포 계산.
 *
 * 광고/PB 제외 — 진짜 자연 검색 결과만 분석 대상.
 */
export function analyzeReviewDistribution(
  response: CoupangKeywordInfoResponse,
  keyword: string,
  options?: { threshold?: number; majorityCount?: number },
): ReviewDistribution {
  const threshold = options?.threshold ?? DEFAULT_REVIEW_THRESHOLD;
  const majorityCount = options?.majorityCount ?? DEFAULT_MAJORITY_COUNT;

  const items = response.data.items;
  const realItems = items.filter((it) => !it.isAd && !it.isPb);
  const reviewCounts = realItems.map((it) => it.reviewCnt);
  const underThresholdCount = reviewCounts.filter((r) => r < threshold).length;
  const realProducts = realItems.length;
  const underThresholdRatio = realProducts > 0 ? underThresholdCount / realProducts : 0;

  return {
    keyword,
    totalProducts: items.length,
    realProducts,
    underThresholdCount,
    underThresholdRatio,
    isMajority: underThresholdCount >= majorityCount,
    threshold,
    majorityCount,
    reviewCounts,
  };
}

// ─────────────────────────────────────────────────────────
// 키워드 chart API (일별 ratio 트렌드 — 시즌 분석용)
// ─────────────────────────────────────────────────────────
//
// POST /api/v1/sellerlife/keyword-analysis/chart
// Body: {"keyword": "..."}
// Response: 2016-01-02 ~ 어제까지의 일별 ratio (0~100 상대지수).
// 키워드당 ~3,800개 데이터 포인트, ~21KB.
//
// 화면의 "월간/1년/3년" 드롭다운은 클라이언트 사이드 표시 변경일 뿐,
// API 는 항상 일별 데이터만 반환. 우리가 직접 월별로 집계한다.

const CHART_URL = 'https://sellochomes.co.kr/api/v1/sellerlife/keyword-analysis/chart';

export interface SCChartDataPoint {
  /** 'YYYY-MM-DD' */
  period: string;
  /** 0~100 상대지수 (그 기간 내 최댓값=100) */
  ratio: number;
}

export interface SCChartResponse {
  success: boolean;
  data?: {
    startDate: string;
    endDate: string;
    timeUnit: string; //   'date'
    results: Array<{
      title: string;
      keywords: string[];
      data: SCChartDataPoint[];
    }>;
  };
}

/**
 * 키워드 일별 ratio 조회 (10년치 전체).
 *
 * @returns 일별 데이터 배열. 키워드가 셀록홈즈에 없으면 빈 배열.
 * @throws SellochomesError 인증 만료/네트워크/응답 깨짐
 */
export async function fetchKeywordChart(keyword: string): Promise<SCChartDataPoint[]> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new SellochomesError('키워드가 비어있습니다.', 'bad_response');
  }

  const cookie = await getSessionCookieHeader();

  let body: SCChartResponse;
  try {
    body = await crawlFetchJson<SCChartResponse>(CHART_URL, {
      source: 'sellochomes',
      endpoint: 'keyword-analysis/chart',
      profile: KEYWORD_ANALYSIS_PROFILE,
      method: 'POST',
      cookie,
      body: JSON.stringify({ keyword: trimmed }),
      contractId: 'sellochomes.chart',
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return handleFetchError(err);
  }

  if (!body.success || !body.data) {
    throw new SellochomesError(
      `chart API success=false`,
      'bad_response',
    );
  }

  // `results` 자체가 없으면 응답 구조가 바뀐 것이고, 빈 배열이면 셀록홈즈에
  // 그 키워드 데이터가 없는 정상 상태다. 예전에는 둘 다 `[]` 로 뭉개져,
  // 호출부가 "데이터 없음" 으로만 표시하고 구조 변경을 영영 모르게 됐다 (P-1).
  if (!Array.isArray(body.data.results)) {
    throw new SellochomesError(
      'chart 응답에 results 배열이 없습니다 (응답 구조 변경 가능).',
      'schema_mismatch',
    );
  }
  const first = body.data.results[0];
  if (!first) return [];
  if (!Array.isArray(first.data)) {
    throw new SellochomesError(
      'chart 응답의 results[0].data 가 배열이 아닙니다 (응답 구조 변경 가능).',
      'schema_mismatch',
    );
  }
  return first.data;
}
