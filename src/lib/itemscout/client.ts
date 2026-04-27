/**
 * 아이템 스카우트 API 클라이언트 (서버 전용)
 *
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-9 (한국어)
 *
 * 역할:
 * - 아이템스카우트 REST API 호출 (i_token 쿠키 인증)
 * - 카테고리 목록, 카테고리별 키워드, 트렌딩 키워드 조회
 * - 서버에서만 실행 — 토큰이 클라이언트에 노출되지 않음
 *
 * 토큰 우선순위:
 * 1. 런타임 메모리 (설정 페이지에서 입력한 값)
 * 2. .env.local ITEMSCOUT_TOKEN
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = 'https://api.itemscout.io/api';
const TOKEN_FILE_PATH = join(process.cwd(), '.data', 'itemscout-token.json');

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
// 토큰 관리
// ─────────────────────────────────────────────────────────

// 런타임 메모리 캐시 (Hot-reload 대비 globalThis)
declare global {
  var __itemscoutToken: string | undefined;
}

/** 파일에서 저장된 토큰을 읽는다 (없으면 null). */
async function readSavedToken(): Promise<string | null> {
  try {
    const raw = await readFile(TOKEN_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

/**
 * 토큰 획득 우선순위:
 * 1. globalThis 메모리 (설정 페이지에서 입력)
 * 2. 파일 (.data/itemscout-token.json)
 * 3. 환경변수 (ITEMSCOUT_TOKEN)
 */
async function getToken(): Promise<string> {
  // 1. 메모리
  if (globalThis.__itemscoutToken) return globalThis.__itemscoutToken;

  // 2. 파일
  const saved = await readSavedToken();
  if (saved) {
    globalThis.__itemscoutToken = saved;
    return saved;
  }

  // 3. 환경변수
  const env = process.env['ITEMSCOUT_TOKEN'];
  if (env) return env;

  throw new Error(
    '아이템스카우트 토큰이 설정되지 않았습니다.\n' +
      '설정 → 아이템스카우트 연결에서 토큰을 입력하세요.',
  );
}

/**
 * 토큰을 저장한다 (메모리 + 파일).
 * Vercel 서버리스는 read-only 파일시스템 → 파일 쓰기 실패해도 globalThis 는 유지됨.
 * 영구 저장은 env 변수(ITEMSCOUT_TOKEN) 업데이트 또는 DB 저장으로 해야 함 (추후 개선).
 */
export async function saveItemScoutToken(token: string): Promise<void> {
  globalThis.__itemscoutToken = token;
  try {
    const dir = join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await writeFile(TOKEN_FILE_PATH, JSON.stringify({ token }, null, 2), 'utf-8');
  } catch (err) {
    // 읽기전용 FS(예: Vercel) 에선 파일 저장 불가 — 에러 로그만 남기고 조용히 무시
    console.warn('[saveItemScoutToken] 파일 저장 실패 (메모리에는 유지됨):', err instanceof Error ? err.message : err);
  }
}

/** 현재 토큰이 설정되어 있는지 확인. */
export async function hasItemScoutToken(): Promise<boolean> {
  try {
    await getToken();
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 내부 API 호출
// ─────────────────────────────────────────────────────────

async function fetchIS<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const url = `${BASE_URL}/${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Cookie: `i_token=${token}`,
      ...options?.headers,
    },
    cache: 'no-store', // 응답 2MB+ 이면 Next 캐시 에러 → 캐시 끔
  });

  if (!res.ok) {
    throw new Error(`[itemscout] API 오류 ${res.status}: ${url}`);
  }

  return res.json() as Promise<T>;
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
  );
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
  const res = await fetchIS<{ data: ISSubcategory[] }>(
    `category/${internalId}/subcategories`,
  );
  return Array.isArray(res.data) ? res.data : [];
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

  const res = await fetchIS<RawResponse>(
    `category/${internalId}/data`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );

  const keywordMap = res.data?.data;
  if (!keywordMap || typeof keywordMap !== 'object') return [];

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
  );
  return Array.isArray(res.data) ? res.data : [];
}
