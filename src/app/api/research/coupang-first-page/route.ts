/**
 * GET /api/research/coupang-first-page?keyword=&lt;검색어&gt; — 쿠팡 1페이지 메트릭 조회
 *
 * 출처: src/lib/sello-scraper/metrics.ts (HUB/BUYWISE 캐시 fallback)
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-2 (실패 시 명시 에러),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 로컬 캐시(data/sello-scrape/<키워드>.json)에서 1페이지 20개 상품의
 *   리뷰수·로켓여부·랭킹 메트릭을 읽어 JSON 반환
 * - 캐시 미스 시 404 + CLI 스크래핑 명령 안내 (웹에서 Playwright 띄우지 않음)
 *
 * 보안:
 * - requireCompanyContext() — 인증 + 회사 컨텍스트 보장
 * - 조회 전용(DB 안 건드림), RLS 불필요
 *
 * 응답:
 * - 200 OK: { ok: true, metrics: FirstPageMetrics }
 * - 400 Bad Request: keyword 쿼리 누락
 * - 404 Not Found: 캐시에 없음 (CLI로 스크래핑 필요)
 * - 500 Internal Server Error: 예상치 못한 에러
 */
import { NextResponse, type NextRequest } from 'next/server';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { scrapeJobs } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { getCoupangFirstPageMetrics } from '@/lib/sello-scraper/metrics';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 인증 (미인증이면 /login 리다이렉트)
  const ctx = await requireCompanyContext();

  const keyword = request.nextUrl.searchParams.get('keyword')?.trim();
  if (!keyword) {
    return NextResponse.json(
      { ok: false, error: '검색할 키워드를 입력하세요 (예: ?keyword=러닝벨트)' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    // 1순위: 로컬 파일 캐시 (local dev)
    const metrics = await getCoupangFirstPageMetrics(keyword).catch(() => null);
    if (metrics) {
      return NextResponse.json({ ok: true, metrics });
    }

    // 2순위: DB 의 가장 최근 done scrape_job (Vercel 환경에서 로컬 파일 시스템 접근 불가)
    //        같은 회사의 해당 키워드 최신 완료 job 을 찾아 result 반환.
    const recentRows = await db
      .select({ result: scrapeJobs.result })
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.company_id, ctx.companyId),
          eq(scrapeJobs.keyword, keyword),
          eq(scrapeJobs.status, 'done'),
        ),
      )
      .orderBy(desc(scrapeJobs.completed_at))
      .limit(1);
    const dbMetrics = recentRows[0]?.result;
    if (dbMetrics) {
      return NextResponse.json({ ok: true, metrics: dbMetrics, source: 'db' });
    }

    // 3순위: 캐시·DB 모두 없음 — 404 + 안내
    return NextResponse.json(
      {
        ok: false,
        error:
          `"${keyword}" 데이터가 없습니다. 로컬에서는 \`npm run sello:scrape -- ${keyword}\` 실행, `
          + `배포 환경에서는 /research/batch-analysis 에서 배치 큐로 요청하세요.`,
        cacheMiss: true,
      },
      { status: HTTP_NOT_FOUND },
    );
  } catch (err) {
    console.error('[api/research/coupang-first-page] 조회 실패:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
      },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}
