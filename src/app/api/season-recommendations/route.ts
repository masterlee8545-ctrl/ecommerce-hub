/**
 * /api/season-recommendations — 자동 시즌 추천 엔진
 *
 * GET ?month=5  (기본: 다음 달)
 *
 * 처리 흐름:
 * 1. DB 의 캐시된 키워드 (last_status='ok') 전체 로드 (~549개)
 * 2. 각 키워드별로 일별 ratio 데이터 로드 → analyzeKeyword() 실행
 * 3. getMonthRelevance(targetMonth) 로 5/4/2/1점 산출
 * 4. 점수별 그룹화 + 정렬
 * 5. 응답
 *
 * 응답:
 * {
 *   ok: true,
 *   month: 5,
 *   totalAnalyzed: 549,
 *   groups: {
 *     now_prep: [...],   //  5점 — 지금 소싱 시작!
 *     rising: [...],      //  4점 — 이번 달부터 급상승
 *     peak_soon: [...],   //  2점 — 다음 달 피크
 *     in_demand: [...],   //  1점 — 진행 중
 *   },
 *   generatedAt: ISO 시간,
 * }
 */
import { NextResponse, type NextRequest } from 'next/server';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { keywordChartDaily, keywordChartFetches } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import {
  analyzeKeyword,
  buildLastYearMonthlyChart,
  getMonthRelevance,
  type KeywordSeasonAnalysis,
  type MonthRelevance,
} from '@/lib/sellochomes/season-analyzer';

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RecommendationItem {
  keyword: string;
  score: number;
  reason: string;
  caution: string;
  analysis: KeywordSeasonAnalysis;
  /** 작년 12개월 막대그래프 (스파크라인용) */
  chart: ReturnType<typeof buildLastYearMonthlyChart>;
}

interface SuccessResponse {
  ok: true;
  month: number;
  totalAnalyzed: number;
  totalRecommended: number;
  groups: {
    now_prep: RecommendationItem[];
    rising: RecommendationItem[];
    peak_soon: RecommendationItem[];
    in_demand: RecommendationItem[];
  };
  generatedAt: string;
  computeMs: number;
}

interface ErrorResponse {
  ok: false;
  error: string;
}

export async function GET(request: NextRequest) {
  await requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const monthStr = searchParams.get('month');

  // 기본: 다음 달 (이번 달 작업 시 다음 달 피크 키워드 미리 준비)
  const now = new Date();
  const defaultMonth = (now.getMonth() + 1) % 12 + 1;
  const month = monthStr !== null ? parseInt(monthStr, 10) : defaultMonth;

  if (isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: 'month는 1~12 사이여야 합니다' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const startedAt = Date.now();

  try {
    // 1) 캐시된 키워드 목록 (status='ok' 만)
    const fetchedKeywords = await db
      .select({ keyword: keywordChartFetches.keyword })
      .from(keywordChartFetches)
      .where(eq(keywordChartFetches.last_status, 'ok'));

    const keywords = fetchedKeywords.map((r) => r.keyword);
    if (keywords.length === 0) {
      return NextResponse.json<SuccessResponse>({
        ok: true,
        month,
        totalAnalyzed: 0,
        totalRecommended: 0,
        groups: { now_prep: [], rising: [], peak_soon: [], in_demand: [] },
        generatedAt: new Date().toISOString(),
        computeMs: Date.now() - startedAt,
      });
    }

    // 2) 일별 데이터 벌크 로드
    //    549개 × 3,780일 ≈ 200만 row. 청크로 나눠서 메모리 부담 줄이기.
    const CHUNK_SIZE = 50;
    const dailyByKeyword = new Map<string, Array<{ period: string; ratio: number }>>();

    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
      const chunk = keywords.slice(i, i + CHUNK_SIZE);
      const rows = await db
        .select({
          keyword: keywordChartDaily.keyword,
          period: keywordChartDaily.period,
          ratio: keywordChartDaily.ratio,
        })
        .from(keywordChartDaily)
        .where(inArray(keywordChartDaily.keyword, chunk));

      for (const r of rows) {
        if (!dailyByKeyword.has(r.keyword)) {
          dailyByKeyword.set(r.keyword, []);
        }
        dailyByKeyword.get(r.keyword)!.push({ period: r.period, ratio: r.ratio });
      }
    }

    // 3) 키워드별 분석 + 점수 계산
    const items: RecommendationItem[] = [];
    for (const keyword of keywords) {
      const daily = dailyByKeyword.get(keyword);
      if (!daily || daily.length === 0) continue;

      const analysis = analyzeKeyword(keyword, daily, { window: 'last_year' });
      if (!analysis) continue;

      // 상시 상품 제외 (시즌 분석 의미 없음)
      if (analysis.is_evergreen) continue;

      const relevance: MonthRelevance = getMonthRelevance(analysis, month);
      if (relevance.score === 0) continue;

      const chart = buildLastYearMonthlyChart(daily);

      items.push({
        keyword,
        score: relevance.score,
        reason: relevance.reason,
        caution: relevance.caution,
        analysis,
        chart,
      });
    }

    // 4) 그룹별 분류 + 점수순 정렬
    const groups = {
      now_prep: items.filter((it) => it.score === 5),
      rising: items.filter((it) => it.score === 4),
      peak_soon: items.filter((it) => it.score === 2),
      in_demand: items.filter((it) => it.score === 1),
    };

    // 각 그룹 내 정렬: 시즌성 배수 내림차순 → 피크 ratio 내림차순
    const sortByStrength = (a: RecommendationItem, b: RecommendationItem) => {
      if (b.analysis.seasonality_ratio !== a.analysis.seasonality_ratio) {
        return b.analysis.seasonality_ratio - a.analysis.seasonality_ratio;
      }
      return b.analysis.peak_ratio - a.analysis.peak_ratio;
    };
    groups.now_prep.sort(sortByStrength);
    groups.rising.sort(sortByStrength);
    groups.peak_soon.sort(sortByStrength);
    groups.in_demand.sort(sortByStrength);

    return NextResponse.json<SuccessResponse>({
      ok: true,
      month,
      totalAnalyzed: keywords.length,
      totalRecommended: items.length,
      groups,
      generatedAt: new Date().toISOString(),
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
