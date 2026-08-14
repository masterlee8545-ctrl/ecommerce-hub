/**
 * 아이템 스카우트 API 클라이언트 (서버 전용)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 명시 에러), §1 P-9 (한국어)
 * ADR: docs/ADR-014.md — 자격증명 금고 + 응답 계약
 *
 * 역할:
 * - 아이템스카우트 REST API 호출 (i_token 쿠키 인증)
 * - 카테고리 목록, 카테고리별 키워드, 트렌딩 키워드 조회
 * - 서버에서만 실행 — 토큰이 클라이언트에 노출되지 않음
 *
 * 토큰 보관은 금고(`@/lib/crawl` vault)가 맡는다:
 *   메모리 → DB(system_settings) → 파일(.data) → 환경변수
 *
 * 예전에는 DB 단계가 없어 Vercel 인스턴스마다 토큰이 따로 놀았다 (설정 화면에서
 * 저장해도 다른 인스턴스에서는 안 보였다). 금고로 옮기면서 셀록홈즈 쿠키와
 * 같은 규칙을 쓰게 됐다.
 */
import { CrawlError, isCrawlError } from '@/lib/crawl/errors';
import { crawlFetchJson, type HeaderProfile } from '@/lib/crawl/fetch';
import {
  clearCredentialCache,
  getCredential,
  hasCredential,
  saveCredential,
} from '@/lib/crawl/vault';

const BASE_URL = 'https://api.itemscout.io/api';

/**
 * 아이템스카우트 화면에서 나가는 요청처럼 보이게 하는 공통 헤더 성격.
 *
 * 예전 코드는 Cookie 만 보냈다. 여기에 헤더를 얹으면서도 **앞뒤가 맞는 조합**만 쓴다:
 * - API 가 `api.itemscout.io`(다른 서브도메인)라 `Sec-Fetch-Site` 는 `same-site` 다
 * - 브라우저는 GET 에 `Origin` 을 붙이지 않으므로 origin 은 비운다
 * - `x-requested-with` 는 이 사이트가 쓰지 않던 헤더라 넣지 않는다
 */
const IS_PROFILE: HeaderProfile = {
  origin: null,
  referer: 'https://itemscout.io/',
  json: false,
  xhr: false,
  secFetchSite: 'same-site',
};

// ─────────────────────────────────────────────────────────
// 타입 — 실제 API 응답 구조에 맞춤
// ─────────────────────────────────────────────────────────

/** categories_map 응답의 개별 카테고리 */
export interface ISCategory {
  id: number;   // 내부 ID (subcategories 등에 사용)
  lv: number;   // 레벨 (1=대분류, 2=중분류, ...)
  n: string;    // 카테고리명
  cid: number;  // 플랫폼 카테고리 ID
  il: number;   // isLeaf (0/1)
  ib: number;   // isBrand (0/1)
}

/**
 * category/{id}/data 응답의 키워드 항목.
 *
 * 쿠팡 필드는 "coupangXxx" 형태로 키워드 객체에 직접 달려 있음 (중첩 아님).
 * coupangCompetitionRatio는 문자열("49.05")로 온다.
 */
export interface ISKeyword {
  keyword: string;
  image: string;
  rank: number;
  keywordId: number;
  monthly: {
    pc: number;
    mobile: number;
    total: number;
    pc_click_r: number;
    mobile_click_r: number;
    avg_click: number;
  } | null;
  prdCnt: number | null;
  firstCategory: string;
  // 쿠팡 데이터 (플랫 필드, null일 수 있음)
  coupangCompetitionRatio: string | null;
  coupangAveragePrice: number | null;
  coupangAverageReviewCount: number | null;
  coupangTotalProductCount: number | null;
  coupangRocketDeliveryRatio: number | null;
  // 기타
  fitPredict?: { shopping: number } | null | undefined;
  bid?: { pc_bid: number; mobile_bid: number } | null | undefined;
}

/** v2/keyword/trend 응답의 트렌딩 키워드 */
export interface ISTrendKeyword {
  keyword: string;
  change: 'UP' | 'DOWN' | 'STABLE';
  rank: number;
  keywordId: number;
  searchCount: number;
  productCount: number;
  firstCategory: string;
  competitionIntensity: number;
}

/** subcategories 응답 항목 */
export interface ISSubcategory {
  id: number;
  level: number;
  name: string;
  category_id: number;
  is_leaf: number;
  platform: number;
}

/**
 * 대분류 + 실제 하위 3개 이름 미리보기.
 *
 * 배경: ItemScout API 가 내려주는 대분류 라벨(n="식품" 등)이
 *       실제 {id}/subcategories 결과와 일치하지 않는 경우가 많다.
 *       (2026-04 현재 15개 중 14개가 엇갈림)
 *       사용자가 라벨만 믿고 클릭했다가 엉뚱한 하위를 보게 되는 걸
 *       방지하기 위해, 카드에 실제 하위 3개를 함께 보여준다.
 */
export interface ISCategoryWithPreview extends ISCategory {
  /** subcategories[0..2].name — 라벨 검증용 미리보기 */
  preview: string[];
  /** 미리보기 로드 실패 시 메시지 (있으면 '?' 표시) */
  previewError?: string;
}

// ─────────────────────────────────────────────────────────
// 토큰 관리 (금고 위임)
// ─────────────────────────────────────────────────────────

/** 토큰을 저장한다. DB 저장이 실패하면 던진다 (조용히 넘기면 다른 인스턴스가 옛 값을 쓴다). */
export async function saveItemScoutToken(token: string): Promise<void> {
  await saveCredential('itemscout_token', token);
}

/** 현재 토큰이 설정되어 있는지 확인. */
export async function hasItemScoutToken(): Promise<boolean> {
  return hasCredential('itemscout_token');
}

// ─────────────────────────────────────────────────────────
// 내부 API 호출
// ─────────────────────────────────────────────────────────

/**
 * 아이템스카우트 API 호출.
 *
 * @param path       `category/...` 같은 경로
 * @param contractId 응답 모양을 검증할 레지스트리 항목 id
 *
 * 401/403 이면 `crawlFetchJson` 이 `session_expired` 로 던진다. 그때 금고 캐시를
 * 비워, 사용자가 새 토큰을 넣자마자 반영되게 한다 — 예전에는 만료 분기 자체가
 * 없어 토큰 만료와 서버 장애가 같은 에러로 뭉개졌다.
 */
async function fetchIS<T>(
  path: string,
  contractId: string,
  options?: { method?: 'GET' | 'POST'; headers?: Record<string, string> },
): Promise<T> {
  const token = await getCredential('itemscout_token');
  try {
    return await crawlFetchJson<T>(`${BASE_URL}/${path}`, {
      source: 'itemscout',
      endpoint: path,
      profile: IS_PROFILE,
      cookie: `i_token=${token}`,
      contractId,
      ...(options?.method ? { method: options.method } : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
    });
  } catch (err) {
    if (isCrawlError(err) && err.code === 'session_expired') {
      clearCredentialCache('itemscout_token');
    }
    throw err;
  }
}

/** 응답이 기대한 모양이 아닐 때. 빈 배열로 감추지 않는다 (P-1). */
function schemaMismatch(endpoint: string, reason: string): CrawlError {
  return new CrawlError('schema_mismatch', { source: 'itemscout', endpoint, reason });
}

// ─────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────

/**
 * 쿠팡 카테고리 트리 — 대분류(lv=1)만 반환.
 */
export async function getCoupangTopCategories(): Promise<ISCategory[]> {
  const res = await fetchIS<{ status: string; data: ISCategory[][] }>(
    'category/coupang_categories_map',
    'itemscout.categories_map',
  );
  if (!Array.isArray(res.data)) {
    throw schemaMismatch('category/coupang_categories_map', 'data 가 배열이 아닙니다');
  }
  const all = res.data.flat();
  return all.filter((c) => c.lv === 1);
}

/** preview에 담을 하위 이름 갯수 */
const PREVIEW_LIMIT = 3;

/**
 * 대분류 + 각 대분류의 실제 하위 카테고리 3개 미리보기.
 *
 * 15개 대분류의 subcategories 를 병렬로 호출한다.
 * 한두 개가 실패해도 전체는 반환하며 실패한 카드만 previewError 를 갖는다.
 *
 * @see ISCategoryWithPreview — 이 함수가 존재하는 이유 (라벨 불일치 방어)
 */
export async function getCoupangTopCategoriesWithPreview(): Promise<ISCategoryWithPreview[]> {
  const tops = await getCoupangTopCategories();
  return Promise.all(
    tops.map(async (c): Promise<ISCategoryWithPreview> => {
      try {
        const subs = await getSubcategories(c.id);
        return { ...c, preview: subs.slice(0, PREVIEW_LIMIT).map((s) => s.name) };
      } catch (err) {
        return {
          ...c,
          preview: [],
          previewError: err instanceof Error ? err.message : '알 수 없는 오류',
        };
      }
    }),
  );
}

/**
 * 특정 카테고리의 하위 카테고리 조회.
 */
export async function getSubcategories(
  internalId: number,
): Promise<ISSubcategory[]> {
  const endpoint = `category/{id}/subcategories`;
  const res = await fetchIS<{ data: ISSubcategory[] }>(
    `category/${internalId}/subcategories`,
    'itemscout.subcategories',
  );
  // 예전에는 배열이 아니면 빈 배열을 돌려줬다. 그러면 "하위 카테고리가 없음"과
  // "응답 구조가 바뀜"이 화면에서 똑같아진다 (P-1 위반).
  if (!Array.isArray(res.data)) {
    throw schemaMismatch(endpoint, 'data 가 배열이 아닙니다');
  }
  return res.data;
}

/**
 * 카테고리 내 트렌딩 키워드 조회.
 *
 * 실제 응답 구조:
 * { status, data: { oldDate, data: { [id]: RawKw }, hasRank, renewStatus } }
 *
 * RawKw.coupang 은 중첩 객체 { coupangCompetitionRatio, ... } 이므로
 * ISKeyword 의 플랫 필드로 정규화한 뒤 반환한다.
 */
export async function getCategoryKeywords(
  internalId: number,
): Promise<ISKeyword[]> {
  /** API 에서 실제로 내려오는 키워드 형태 (coupang이 중첩 객체) */
  interface RawCoupang {
    coupangCompetitionRatio?: string | null;
    coupangAveragePrice?: number | null;
    coupangAverageReviewCount?: number | null;
    coupangTotalProductCount?: number | null;
    coupangRocketDeliveryRatio?: number | null;
  }

  interface RawKeyword {
    keyword: string;
    image: string;
    rank: number;
    keywordId: number;
    monthly: ISKeyword['monthly'];
    prdCnt: number;
    firstCategory: string;
    coupang?: RawCoupang | null;
    fitPredict?: { shopping: number } | null;
    bid?: { pc_bid: number; mobile_bid: number } | null;
  }

  interface RawResponse {
    status: string;
    data: {
      oldDate: string | null;
      data: Record<string, RawKeyword> | null;
      hasRank: boolean;
      renewStatus: number;
    };
  }

  const endpoint = 'category/{id}/data';
  const res = await fetchIS<RawResponse>(
    `category/${internalId}/data`,
    'itemscout.category_data',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );

  const keywordMap = res.data?.data;
  // `data.data` 가 null 이면 아이템스카우트가 아직 이 카테고리를 집계하지 않은
  // 정상 상태다 (renewStatus 로 표현된다). 반면 객체가 아닌 다른 타입이면
  // 응답 구조가 바뀐 것이므로 구분해서 던진다.
  if (keywordMap === null || keywordMap === undefined) return [];
  if (typeof keywordMap !== 'object' || Array.isArray(keywordMap)) {
    throw schemaMismatch(endpoint, 'data.data 가 키워드 맵이 아닙니다');
  }

  // 중첩 coupang 객체 → 플랫 필드로 정규화
  return Object.values(keywordMap).map((raw): ISKeyword => ({
    keyword: raw.keyword,
    image: raw.image,
    rank: raw.rank,
    keywordId: raw.keywordId,
    monthly: raw.monthly ?? null,
    prdCnt: raw.prdCnt ?? null,
    firstCategory: raw.firstCategory,
    coupangCompetitionRatio: raw.coupang?.coupangCompetitionRatio ?? null,
    coupangAveragePrice: raw.coupang?.coupangAveragePrice ?? null,
    coupangAverageReviewCount: raw.coupang?.coupangAverageReviewCount ?? null,
    coupangTotalProductCount: raw.coupang?.coupangTotalProductCount ?? null,
    coupangRocketDeliveryRatio: raw.coupang?.coupangRocketDeliveryRatio ?? null,
    fitPredict: raw.fitPredict,
    bid: raw.bid,
  }));
}

/**
 * 전체 트렌딩 키워드 (상위 20개).
 */
export async function getTrendingKeywords(): Promise<ISTrendKeyword[]> {
  const res = await fetchIS<{ data: ISTrendKeyword[] }>(
    'v2/keyword/trend',
    'itemscout.keyword_trend',
  );
  if (!Array.isArray(res.data)) {
    throw schemaMismatch('v2/keyword/trend', 'data 가 배열이 아닙니다');
  }
  return res.data;
}
