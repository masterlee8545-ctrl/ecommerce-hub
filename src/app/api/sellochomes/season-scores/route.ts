/**
 * /api/sellochomes/season-scores — 키워드 목록의 시즌 점수 일괄 조회
 *
 * 카테고리 items API 로 받은 키워드 50개 (또는 N개) 의 시즌 점수를 한 번에 반환.
 * DB 캐시된 키워드만 분석 — 캐시 없으면 score=null (UI 에서 "분석" 버튼 노출).
 *
 * POST body:
 *   { keywords: ["참외", "수박", ...], month: 5 }
 *
 * 응답:
 *   {
 *     ok: true,
 *     month: 5,
 *     scores: {
 *       "참외": { score: 5, reason: "...", analysis: {...} },
 *       "수박": null,  // 캐시 없음
 *       ...
 *     },
 *     cached: 23, missing: 27
 *   }
 */
import { NextResponse, type NextRequest } from 'next/server';

import { inArray } from 'drizzle-orm';

import { db } from '@/db';
import { keywordChartDaily, keywordChartFetches } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import {
  analyzeKeyword,
  getMonthRelevance,
  type KeywordSeasonAnalysis,
} from '@/lib/sellochomes/season-analyzer';

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface KeywordScore {
  score: number;
  reason: string;
  caution: string;
  analysis: Pick<
    KeywordSeasonAnalysis,
    | 'peak_month'
    | 'prep_month'
    | 'rise_month'
    | 'seasonality_ratio'
    | 'demand_period'
    | 'is_evergreen'
  >;
}

interface SuccessResponse {
  ok: true;
  month: number;
  scores: Record<string, KeywordScore | null>;
  cached: number;
  missing: number;
  computeMs: number;
}

interface ErrorResponse {
  ok: false;
  error: string;
}

export async function POST(request: NextRequest) {
  await requireCompanyContext();

  let body: { keywords?: unknown; month?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: 'JSON body 파싱 실패' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  const month = typeof body.month === 'number' && body.month >= 1 && body.month <= 12
    ? body.month
    : null;

  if (keywords.length === 0) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: 'keywords 배열이 필요합니다' },
      { status: HTTP_BAD_REQUEST },
    );
  }
  if (month === null) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: 'month는 1~12 사이여야 합니다' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const startedAt = Date.now();

  try {
    // 1) 캐시에 있는 키워드만 추출
    const fetched = await db
      .select({ keyword: keywordChartFetches.keyword })
      .from(keywordChartFetches)
      .where(inArray(keywordChartFetches.keyword, keywords));
    const cachedKeywords = new Set(fetched.map((r) => r.keyword));

    // 2) 캐시된 키워드의 일별 데이터 벌크 로드
    const scores: Record<string, KeywordScore | null> = {};
    for (const kw of keywords) {
      if (!cachedKeywords.has(kw)) {
        scores[kw] = null;
      }
    }

    const cachedList = Array.from(cachedKeywords);
    if (cachedList.length > 0) {
      // 청크 처리 (Postgres 파라미터 한도 + 메모리)
      const CHUNK = 50;
      const dailyByKeyword = new Map<
        string,
        Array<{ period: string; ratio: number }>
      >();

      for (let i = 0; i < cachedList.length; i += CHUNK) {
        const chunk = cachedList.slice(i, i + CHUNK);
        const rows = await db
          .select({
            keyword: keywordChartDaily.keyword,
            period: keywordChartDaily.period,
            ratio: keywordChartDaily.ratio,
          })
          .from(keywordChartDaily)
          .where(inArray(keywordChartDaily.keyword, chunk));

        for (const r of rows) {
          if (!dailyByKeyword.has(r.keyword)) dailyByKeyword.set(r.keyword, []);
          dailyByKeyword.get(r.keyword)!.push({
            period: r.period,
            ratio: r.ratio,
          });
        }
      }

      // 3) 키워드별 분석 + 점수
      for (const kw of cachedList) {
        const daily = dailyByKeyword.get(kw);
        if (!daily || daily.length === 0) {
          scores[kw] = null;
          continue;
        }
        const analysis = analyzeKeyword(kw, daily, { window: 'last_year' });
        if (!analysis) {
          scores[kw] = null;
          continue;
        }
        const relevance = getMonthRelevance(analysis, month);
        scores[kw] = {
          score: relevance.score,
          reason: relevance.reason,
          caution: relevance.caution,
          analysis: {
            peak_month: analysis.peak_month,
            prep_month: analysis.prep_month,
            rise_month: analysis.rise_month,
            seasonality_ratio: analysis.seasonality_ratio,
            demand_period: analysis.demand_period,
            is_evergreen: analysis.is_evergreen,
          },
        };
      }
    }

    const cached = Object.values(scores).filter((s) => s !== null).length;
    const missing = keywords.length - cached;

    return NextResponse.json<SuccessResponse>({
      ok: true,
      month,
      scores,
      cached,
      missing,
      computeMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json<ErrorResponse>(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: HTTP_INTERNAL },
    );
  }
}
