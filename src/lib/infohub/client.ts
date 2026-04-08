/**
 * InfoHub REST 클라이언트 (모드 B)
 *
 * 출처: docs/INFOHUB_INTEGRATION.md, docs/ADR.md ADR-011, .env.local.example §6.5
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 throw),
 *       §1 P-3 (estimated 마킹), §1 P-8 (형제 프로젝트 응답 스키마 가정 금지)
 *
 * 역할:
 * - InfoHub Vercel 앱의 REST API를 호출 (`INFOHUB_URL`)
 * - 응답을 반드시 zod 스키마(`InfoHubSearchResponseSchema`)로 검증
 * - 검증 실패 시 InfoHubSchemaError throw — agents/bugs.md 등록 강제
 * - 6시간 캐시 (모듈 메모리 캐시 — Phase 1; Phase 2는 Redis로 전환)
 *
 * 모드 구분:
 * - 모드 A (현재): Claude Code 세션에서 mcp__infohub__* 도구로 직접 호출
 * - 모드 B (이 파일): Next.js 앱이 직접 InfoHub REST API 호출
 *
 * 동작:
 * - INFOHUB_URL이나 INFOHUB_AUTH_TOKEN이 비어 있으면 InfoHubCallError throw
 * - 호출자(트렌드 페이지)는 try-catch 후 친절한 한국어 에러 표시
 *
 * ⚠ 멀티테넌트:
 * - InfoHub는 사용자별 데이터다 (InfoHub의 user_id는 우리 회사 ID와 무관)
 * - 우리 시스템에 저장할 때 company_id를 반드시 부여 (BuywiseInfoHubArticleSchema)
 */
import {
  InfoHubCallError,
  InfoHubSchemaError,
  InfoHubSearchResponseSchema,
  type InfoHubItem,
} from './schema';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CACHE_TTL_SEC = 21600; //  6시간
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const SEC_TO_MS = 1000;

// ─────────────────────────────────────────────────────────
// 메모리 캐시 (Phase 1 단순 구현 — 프로세스 재시작 시 초기화됨)
// ─────────────────────────────────────────────────────────

interface CacheEntry {
  fetchedAt: number; //   Date.now()
  items: InfoHubItem[];
  total: number;
}

declare global {
  var __infohubCache: Map<string, CacheEntry> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  if (!globalThis.__infohubCache) {
    globalThis.__infohubCache = new Map();
  }
  return globalThis.__infohubCache;
}

function getCacheTtlMs(): number {
  const raw = process.env['INFOHUB_CACHE_TTL_SEC'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const ttlSec = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_SEC;
  return ttlSec * SEC_TO_MS;
}

// ─────────────────────────────────────────────────────────
// 환경변수 가드
// ─────────────────────────────────────────────────────────

interface InfoHubConfig {
  baseUrl: string;
  authToken: string;
  timeoutMs: number;
}

function loadConfig(): InfoHubConfig {
  const baseUrl = process.env['INFOHUB_URL'];
  const authToken = process.env['INFOHUB_AUTH_TOKEN'];

  if (!baseUrl || baseUrl.length === 0) {
    throw new InfoHubCallError('INFOHUB_URL 환경변수가 설정되지 않았습니다.', 'config');
  }
  if (!authToken || authToken.length === 0) {
    throw new InfoHubCallError(
      'INFOHUB_AUTH_TOKEN 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.',
      'config',
    );
  }

  const rawTimeout = process.env['INFOHUB_TIMEOUT_MS'];
  const parsedTimeout = rawTimeout ? parseInt(rawTimeout, 10) : NaN;
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

  return { baseUrl: baseUrl.replace(/\/$/, ''), authToken, timeoutMs };
}

// ─────────────────────────────────────────────────────────
// fetch 헬퍼 (timeout + 인증 + 에러 통합)
// ─────────────────────────────────────────────────────────

async function infohubFetch(
  endpoint: string,
  init: RequestInit,
  config: InfoHubConfig,
): Promise<unknown> {
  const url = `${config.baseUrl}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.authToken}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status < HTTP_OK_MIN || response.status >= HTTP_OK_MAX) {
      const text = await response.text().catch(() => '');
      throw new InfoHubCallError(
        `HTTP ${response.status}: ${text.slice(0, HTTP_OK_MIN)}`,
        endpoint,
      );
    }

    return await response.json();
  } catch (err) {
    if (err instanceof InfoHubCallError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InfoHubCallError(
        `요청 시간이 초과되었습니다 (${config.timeoutMs}ms).`,
        endpoint,
        err,
      );
    }
    throw new InfoHubCallError(
      err instanceof Error ? err.message : String(err),
      endpoint,
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────
// 검색 (트렌드 카드용)
// ─────────────────────────────────────────────────────────

export interface SearchTrendsParams {
  /** 검색 키워드 (예: '주방용품 트렌드') */
  query: string;
  /** 카테고리 필터 (선택) */
  category?: string;
  /** 결과 최대 개수 (기본 10) */
  limit?: number;
}

export interface SearchTrendsResult {
  items: InfoHubItem[];
  total: number;
  /** 캐시에서 왔는지 (true면 다시 호출 안 함) */
  cached: boolean;
  /** 가져온 시각 (Unix ms) — 사용자 노출용 */
  fetchedAt: number;
}

const DEFAULT_LIMIT = 10;

/**
 * InfoHub에서 키워드로 트렌드 아이템을 검색한다.
 *
 * 캐시 동작:
 * - 같은 query+category+limit 조합은 메모리 캐시 (6시간 TTL)
 * - 만료 시 자동 재호출
 *
 * @throws InfoHubCallError — config 누락, 네트워크 실패, HTTP 4xx/5xx
 * @throws InfoHubSchemaError — 응답이 zod 스키마와 불일치 (B-001 사례)
 */
export async function searchInfoHubTrends(
  params: SearchTrendsParams,
): Promise<SearchTrendsResult> {
  const config = loadConfig();
  const limit = params.limit ?? DEFAULT_LIMIT;

  // 캐시 키
  const cacheKey = JSON.stringify({
    q: params.query,
    c: params.category ?? '',
    l: limit,
  });
  const cache = getCache();
  const ttlMs = getCacheTtlMs();
  const now = Date.now();

  const hit = cache.get(cacheKey);
  if (hit && now - hit.fetchedAt < ttlMs) {
    return {
      items: hit.items,
      total: hit.total,
      cached: true,
      fetchedAt: hit.fetchedAt,
    };
  }

  // 호출
  const queryString = new URLSearchParams({
    q: params.query,
    limit: String(limit),
  });
  if (params.category) {
    queryString.set('category', params.category);
  }

  const endpoint = `/api/search?${queryString.toString()}`;
  const raw = await infohubFetch(endpoint, { method: 'GET' }, config);

  // zod 검증 — B-001 방지
  const validation = InfoHubSearchResponseSchema.safeParse(raw);
  if (!validation.success) {
    throw new InfoHubSchemaError(
      'InfoHub /api/search 응답이 예상 스키마와 다릅니다.',
      endpoint,
      validation.error,
    );
  }

  // 캐시 저장
  cache.set(cacheKey, {
    fetchedAt: now,
    items: validation.data.items,
    total: validation.data.total,
  });

  return {
    items: validation.data.items,
    total: validation.data.total,
    cached: false,
    fetchedAt: now,
  };
}

// ─────────────────────────────────────────────────────────
// 캐시 강제 무효화 (테스트/관리자용)
// ─────────────────────────────────────────────────────────

export function clearInfoHubCache(): void {
  getCache().clear();
}
