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
 * 쿠키 우선순위 (ItemScout 패턴 동일):
 * 1. globalThis 메모리 (설정 페이지에서 입력)
 * 2. 파일 (.data/sellochomes-cookie.json)
 * 3. 환경변수 (SELLOCHOMES_COOKIE)
 *
 * 핵심 API:
 * - moveCategoryPage: wholeCategoryName(한글 경로) → queryCategoryId + 카테고리 트리
 * - items: categoryId + page → 40개 키워드 배열 (discoveryCnt 로 총 개수)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = 'https://sellochomes.co.kr/api/v1/sellerlife';
const DEFAULT_TIMEOUT_MS = 15_000;
const COOKIE_FILE_PATH = join(process.cwd(), '.data', 'sellochomes-cookie.json');

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
// 쿠키 관리 (메모리 > 파일 > 환경변수)
// ─────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __sellochomesCookie: string | undefined;
}

/** 파일에서 저장된 쿠키를 읽는다 (없으면 null). */
async function readSavedCookie(): Promise<string | null> {
  try {
    const raw = await readFile(COOKIE_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { cookie?: string };
    return parsed.cookie ?? null;
  } catch {
    return null;
  }
}

/**
 * 쿠키 획득 우선순위:
 * 1. globalThis 메모리 (설정 페이지에서 입력)
 * 2. 파일 (.data/sellochomes-cookie.json)
 * 3. 환경변수 (SELLOCHOMES_COOKIE)
 */
async function getCookieValue(): Promise<string> {
  // 1. 메모리
  if (globalThis.__sellochomesCookie) return globalThis.__sellochomesCookie;

  // 2. 파일
  const saved = await readSavedCookie();
  if (saved) {
    globalThis.__sellochomesCookie = saved;
    return saved;
  }

  // 3. 환경변수
  const env = process.env['SELLOCHOMES_COOKIE'];
  if (env && env.trim().length > 0) return env.trim();

  throw new SellochomesError(
    '셀록홈즈 쿠키가 설정되지 않았습니다. 설정 → 셀록홈즈 연결에서 쿠키를 입력하세요.',
    'no_cookie',
  );
}

/**
 * 쿠키를 저장한다 (메모리 + 파일).
 * Vercel 서버리스는 read-only FS → 파일 쓰기 실패해도 globalThis 는 유지됨.
 */
export async function saveSellochomesCookie(cookie: string): Promise<void> {
  globalThis.__sellochomesCookie = cookie;
  try {
    const dir = join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await writeFile(COOKIE_FILE_PATH, JSON.stringify({ cookie }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(
      '[saveSellochomesCookie] 파일 저장 실패 (메모리에는 유지됨):',
      err instanceof Error ? err.message : err,
    );
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
