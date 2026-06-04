/**
 * /api/sellochomes/chart — 단일 키워드 시즌 분석
 *
 * GET ?keyword=러닝벨트 [&refresh=true]
 *
 * 처리 흐름:
 * 1. DB 캐시 확인 (24시간 이내인지)
 * 2. 캐시 미스 또는 refresh=true → 셀록홈즈 chart API 호출 → DB 저장
 * 3. analyzeKeyword() 실행 (작년 1년 윈도우 — 형 요청)
 * 4. 작년 12개월 막대그래프 데이터 산출
 * 5. 분석 + 차트 반환
 *
 * 응답:
 * {
 *   ok: true,
 *   keyword,
 *   fromCache: boolean,
 *   freshness: '2시간 전' | ...,
 *   analysis: KeywordSeasonAnalysis | null,  // 데이터 없으면 null
 *   chart: Array<{ month, label, ratio }>     // 12개 (작년 월별)
 * }
 */
import { NextResponse, type NextRequest } from 'next/server';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { keywordChartDaily, keywordChartFetches } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import {
  fetchKeywordChart,
  SellochomesError,
  type SCChartDataPoint,
} from '@/lib/sellochomes/client';
import {
  analyzeKeyword,
  buildLastYearMonthlyChart,
} from '@/lib/sellochomes/season-analyzer';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_INTERNAL = 500;

const CACHE_TTL_HOURS = 24;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SuccessResponse {
  ok: true;
  keyword: string;
  fromCache: boolean;
  freshness: string;
  analysis: ReturnType<typeof analyzeKeyword>;
  chart: ReturnType<typeof buildLastYearMonthlyChart>;
}

interface ErrorResponse {
  ok: false;
  error: string;
  code?: string;
}

export async function GET(request: NextRequest) {
  await requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const forceRefresh = searchParams.get('refresh') === 'true';

  if (!keyword) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: '키워드가 필요합니다 (?keyword=...)' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    // 1) 캐시 확인
    const fetchInfo = await loadFetchInfo(keyword);
    const isCacheFresh =
      fetchInfo !== null &&
      Date.now() - new Date(fetchInfo.fetched_at).getTime() < CACHE_TTL_HOURS * 3600_000;

    let dailyData: SCChartDataPoint[] = [];
    let fromCache = false;

    if (!forceRefresh && isCacheFresh) {
      // 캐시 히트 — DB 에서만 로드
      dailyData = await loadDailyFromDB(keyword);
      fromCache = true;
    }

    if (!fromCache || dailyData.length === 0) {
      // 캐시 미스 → 셀록홈즈 호출
      const fetched = await fetchKeywordChart(keyword);
      if (fetched.length === 0) {
        // 키워드가 셀록홈즈에 없는 경우 — 빈 응답
        await upsertFetchLog(keyword, [], 'no_data');
        return NextResponse.json<SuccessResponse>({
          ok: true,
          keyword,
          fromCache: false,
          freshness: '방금 전',
          analysis: null,
          chart: buildLastYearMonthlyChart([]),
        });
      }
      // DB 저장
      await saveDailyToDB(keyword, fetched);
      await upsertFetchLog(keyword, fetched, 'ok');
      dailyData = fetched;
    }

    // 2) 분석 (작년 1년 윈도우)
    const analysis = analyzeKeyword(keyword, dailyData, { window: 'last_year' });
    const chart = buildLastYearMonthlyChart(dailyData);

    return NextResponse.json<SuccessResponse>({
      ok: true,
      keyword,
      fromCache,
      freshness: getFreshness(fetchInfo?.fetched_at ?? new Date().toISOString()),
      analysis,
      chart,
    });
  } catch (err) {
    if (err instanceof SellochomesError) {
      // 인증 만료 / 네트워크 실패 / 응답 깨짐
      const status = err.code === 'auth_expired' ? HTTP_UNAUTHORIZED : HTTP_INTERNAL;
      return NextResponse.json<ErrorResponse>(
        { ok: false, error: err.message, code: err.code },
        { status },
      );
    }
    return NextResponse.json<ErrorResponse>(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: HTTP_INTERNAL },
    );
  }
}

// ─────────────────────────────────────────────────────────
// DB 헬퍼
// ─────────────────────────────────────────────────────────

async function loadFetchInfo(
  keyword: string,
): Promise<{ fetched_at: Date | string; point_count: number } | null> {
  const rows = await db
    .select({
      fetched_at: keywordChartFetches.fetched_at,
      point_count: keywordChartFetches.point_count,
    })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.keyword, keyword))
    .limit(1);
  return rows[0] ?? null;
}

async function loadDailyFromDB(keyword: string): Promise<SCChartDataPoint[]> {
  const rows = await db
    .select({
      period: keywordChartDaily.period,
      ratio: keywordChartDaily.ratio,
    })
    .from(keywordChartDaily)
    .where(eq(keywordChartDaily.keyword, keyword));
  return rows.map((r) => ({ period: r.period, ratio: r.ratio }));
}

async function saveDailyToDB(
  keyword: string,
  data: SCChartDataPoint[],
): Promise<void> {
  if (data.length === 0) return;

  // 기존 데이터 삭제 (간단 — 갱신 시 깔끔)
  // 30일 이내 데이터만 갱신하는 최적화는 추후
  await db.delete(keywordChartDaily).where(eq(keywordChartDaily.keyword, keyword));

  // 청크로 insert (Postgres 파라미터 한도 고려)
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK).map((d) => ({
      keyword,
      period: d.period,
      ratio: d.ratio,
    }));
    await db.insert(keywordChartDaily).values(chunk);
  }
}

async function upsertFetchLog(
  keyword: string,
  data: SCChartDataPoint[],
  status: 'ok' | 'no_data' | 'error' | 'auth_expired',
): Promise<void> {
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
  const start = sorted[0]?.period ?? null;
  const end = sorted[sorted.length - 1]?.period ?? null;

  await db
    .insert(keywordChartFetches)
    .values({
      keyword,
      fetched_at: new Date(),
      data_start_date: start,
      data_end_date: end,
      point_count: data.length,
      last_status: status,
    })
    .onConflictDoUpdate({
      target: keywordChartFetches.keyword,
      set: {
        fetched_at: new Date(),
        data_start_date: start,
        data_end_date: end,
        point_count: data.length,
        last_status: status,
      },
    });
}

function getFreshness(fetchedAt: Date | string): string {
  const t = typeof fetchedAt === 'string' ? new Date(fetchedAt).getTime() : fetchedAt.getTime();
  const deltaMs = Date.now() - t;
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
