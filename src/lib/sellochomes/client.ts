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
 * 쿠키 우선순위:
 * 1. globalThis 메모리 (같은 서버리스 인스턴스 내 캐시 — 짧은 TTL)
 * 2. DB system_settings 테이블 (Vercel 인스턴스 간 공유 — 영구 저장소)
 * 3. 파일 (.data/sellochomes-cookie.json) — 로컬 개발용 폴백
 * 4. 환경변수 (SELLOCHOMES_COOKIE) — 최후 폴백
 *
 * 왜 DB 가 메모리 다음:
 *   Vercel 서버리스는 인스턴스 여러 개. 메모리/파일 저장은 인스턴스별 분리되어
 *   /settings 에서 저장한 쿠키가 다른 인스턴스에서 안 보임. DB 가 유일한 공유처.
 *
 * 핵심 API:
 * - moveCategoryPage: wholeCategoryName(한글 경로) → queryCategoryId + 카테고리 트리
 * - items: categoryId + page → 40개 키워드 배열 (discoveryCnt 로 총 개수)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { systemSettings } from '@/db/schema';

const BASE_URL = 'https://sellochomes.co.kr/api/v1/sellerlife';
const DEFAULT_TIMEOUT_MS = 15_000;
const COOKIE_FILE_PATH = join(process.cwd(), '.data', 'sellochomes-cookie.json');
const COOKIE_DB_KEY = 'sellochomes_cookie';
// 메모리 캐시 TTL — 너무 길면 사용자가 갱신해도 다른 인스턴스에서 옛 값 봄.
// 30초면 갱신 후 곧바로 반영 + DB 부하 절감 사이 균형.
const MEMORY_CACHE_TTL_MS = 30_000;

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
      | 'category_not_found',
  ) {
    super(message);
    this.name = 'SellochomesError';
  }
}

// ─────────────────────────────────────────────────────────
// 쿠키 관리 (메모리 → DB → 파일 → 환경변수)
// ─────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __sellochomesCookieCache:
    | { value: string; cachedAt: number }
    | undefined;
}

/** 파일에서 저장된 쿠키를 읽는다 (로컬 개발용 폴백, Vercel 에선 항상 null). */
async function readFileCookie(): Promise<string | null> {
  try {
    const raw = await readFile(COOKIE_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { cookie?: string };
    return parsed.cookie ?? null;
  } catch {
    return null;
  }
}

/** DB 에서 쿠키 조회 (Vercel 인스턴스 간 공유 영구 저장소). */
async function readDbCookie(): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, COOKIE_DB_KEY))
      .limit(1);
    return rows[0]?.value ?? null;
  } catch (err) {
    // DB 마이그레이션 안 됐거나 연결 실패 — 폴백 체인 계속
    console.warn(
      '[readDbCookie] DB 조회 실패 (마이그레이션 미적용 가능):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 쿠키 획득 우선순위:
 * 1. globalThis 메모리 (TTL 30초 — 빠른 인스턴스 내 재사용)
 * 2. DB system_settings (Vercel 인스턴스 간 공유)
 * 3. 파일 (.data/sellochomes-cookie.json) — 로컬 개발 폴백
 * 4. 환경변수 (SELLOCHOMES_COOKIE) — 최후 폴백
 */
async function getCookieValue(): Promise<string> {
  // 1. 메모리 (TTL 내)
  const cache = globalThis.__sellochomesCookieCache;
  if (cache && Date.now() - cache.cachedAt < MEMORY_CACHE_TTL_MS) {
    return cache.value;
  }

  // 2. DB
  const fromDb = await readDbCookie();
  if (fromDb) {
    globalThis.__sellochomesCookieCache = { value: fromDb, cachedAt: Date.now() };
    return fromDb;
  }

  // 3. 파일 (로컬)
  const fromFile = await readFileCookie();
  if (fromFile) {
    globalThis.__sellochomesCookieCache = { value: fromFile, cachedAt: Date.now() };
    return fromFile;
  }

  // 4. 환경변수
  const env = process.env['SELLOCHOMES_COOKIE'];
  if (env && env.trim().length > 0) return env.trim();

  throw new SellochomesError(
    '셀록홈즈 쿠키가 설정되지 않았습니다. 설정 → 셀록홈즈 연결에서 쿠키를 입력하세요.',
    'no_cookie',
  );
}

/**
 * 쿠키를 저장한다 (DB 우선 + 메모리 캐시 갱신 + 파일 best-effort).
 * Vercel 서버리스 다중 인스턴스 환경에서도 즉시 반영되려면 DB 저장이 필수.
 */
export async function saveSellochomesCookie(cookie: string): Promise<void> {
  // 1. DB upsert (인스턴스 간 공유 — 핵심)
  try {
    await db
      .insert(systemSettings)
      .values({ key: COOKIE_DB_KEY, value: cookie })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: cookie, updatedAt: new Date() },
      });
  } catch (err) {
    // DB 저장 실패는 치명적 — 사용자에게 에러 노출 (action 에서 throw 처리)
    throw new SellochomesError(
      `쿠키 DB 저장 실패: ${err instanceof Error ? err.message : String(err)}. 마이그레이션(0008_system_settings) 적용 여부 확인.`,
      'bad_response',
    );
  }

  // 2. 현재 인스턴스 메모리 캐시 갱신 — 즉시 반영
  globalThis.__sellochomesCookieCache = { value: cookie, cachedAt: Date.now() };

  // 3. 파일도 best-effort (로컬 개발 편의)
  try {
    const dir = join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await writeFile(COOKIE_FILE_PATH, JSON.stringify({ cookie }, null, 2), 'utf-8');
  } catch {
    // Vercel 에선 read-only FS → 실패 무시 (DB 가 source of truth)
  }
}

/** HTTP Cookie 헤더 형태로 변환 (`connect.sid=...`) */
async function getCookieHeader(): Promise<string> {
  const value = await getCookieValue();
  return `connect.sid=${value}`;
}

async function fetchSC<T>(path: string, search?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (search) {
    for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const cookieHeader = await getCookieHeader();

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        Referer: 'https://sellochomes.co.kr/sellerlife/sourcing/category/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    throw new SellochomesError(
      `셀록홈즈 연결 실패: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  }
  clearTimeout(tid);

  if (res.status === 401 || res.status === 403) {
    throw new SellochomesError(
      '셀록홈즈 세션이 만료됐습니다. 쿠키를 재발급하세요.',
      'auth_expired',
    );
  }
  if (!res.ok) {
    throw new SellochomesError(
      `셀록홈즈 API 응답 실패 (HTTP ${res.status})`,
      'bad_response',
    );
  }

  const body = (await res.json()) as T;
  return body;
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
  const res = await fetchSC<SCItemsResponse>('/sourcing/category/items', {
    category: categoryId,
    page: String(page),
    first: page === 1 ? 'true' : 'false',
    sort: options?.sort ?? '-1',
    column: options?.column ?? '',
  });
  return res;
}

/**
 * 카테고리 전체 키워드(여러 페이지) 수집.
 * discoveryCnt / 40 만큼 페이지네이션.
 * 일반적으로 400~500개 → 10~13번 호출.
 */
export async function fetchAllCategoryKeywords(
  categoryId: string,
  options?: { maxPages?: number },
): Promise<SCKeyword[]> {
  const first = await fetchCategoryItems(categoryId, { page: 1 });
  const totalCnt = first.discoveryCnt;
  const pageSize = first.discoveryData.length; // 보통 40
  if (pageSize === 0) return [];

  const totalPages = Math.ceil(totalCnt / pageSize);
  const maxPages = Math.min(totalPages, options?.maxPages ?? 15); //  안전 상한

  const keywords: SCKeyword[] = [...first.discoveryData];
  for (let p = 2; p <= maxPages; p++) {
    const next = await fetchCategoryItems(categoryId, { page: p });
    keywords.push(...next.discoveryData);
    if (next.discoveryData.length === 0) break;
  }
  return keywords;
}

/** 쿠키 설정 여부 확인 (/settings 상태 표시용) — 메모리/파일/env 어디든 있으면 true */
export async function hasSellochomesCookie(): Promise<boolean> {
  try {
    await getCookieValue();
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 쿠팡 키워드 1페이지 상품 분석 (직접 API)
// ─────────────────────────────────────────────────────────
//
// 셀록홈즈 사용량 1회 차감 = 1키워드 분석 (사장님 구독 한도 내)
// 이 API 가 주는 데이터는 셀록홈즈가 화면에 노출하는 것과 동일.
// 셀러라이프 확장이 필요한 판매량/조회수는 null 로 옴 (우리는 리뷰만 필요).

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

  const cookieHeader = await getCookieHeader();
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    throw new SellochomesError(
      `셀록홈즈 키워드 분석 API 연결 실패: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  }
  clearTimeout(tid);

  if (res.status === 401 || res.status === 403) {
    throw new SellochomesError(
      '셀록홈즈 세션이 만료됐습니다. /settings 에서 쿠키를 재발급하세요.',
      'auth_expired',
    );
  }
  if (!res.ok) {
    throw new SellochomesError(
      `셀록홈즈 키워드 분석 API 응답 실패 (HTTP ${res.status})`,
      'bad_response',
    );
  }

  const body = (await res.json()) as CoupangKeywordInfoResponse;
  if (!body.success || !body.data) {
    throw new SellochomesError('셀록홈즈 키워드 분석 응답이 비정상입니다.', 'bad_response');
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
  const threshold = options?.threshold ?? 500;
  const majorityCount = options?.majorityCount ?? 10;

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
