/**
 * POST /api/research/coupang-first-page/scrape — 실시간 스크래핑 트리거
 *
 * 출처: 소싱 워크플로우 Step 2 — 실시간 스크래핑 요구
 * 헌법: CLAUDE.md §1 P-2 (실패 명시), §1 P-4 (인증 강제), §1 P-9 (한국어)
 *
 * 역할:
 * - 키워드를 받아 Windows 로컬 Chrome 에서 셀록홈즈 스크래핑 실행
 * - 완료되면 캐시(`data/sello-scrape/<keyword>.json`) 갱신
 * - 호출자는 이후 GET /api/research/coupang-first-page 로 메트릭 조회
 *
 * 제약:
 * - **로컬 dev 서버 전용** (Windows + Chrome). Vercel 배포 시 동작 안 함.
 * - 30~90초 소요 — 클라이언트 timeout 충분히 설정 필요.
 * - 동시 스크래핑 차단 (싱글톤 락).
 * - 쿠팡 윙 로그인 불필요 / 셀록홈즈 로그인은 프로필에 저장돼 있어야 함.
 *
 * 응답:
 * - 200 OK: { ok: true, keyword, rowCount, filledCount, jsonPath }
 * - 409 Conflict: 다른 스크래핑 진행 중 (locked)
 * - 412 Precondition Failed: 셀록홈즈 로그인 필요 (login-required)
 * - 503 Service Unavailable: Chrome 실행 실패 (launch-failed)
 * - 500 Internal Server Error: 기타 실패
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireCompanyContext } from '@/lib/auth/session';
import { getCurrentScrapeLock, runSelloScrape } from '@/lib/sello-scraper/run-scrape';

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_PRECONDITION_FAILED = 412;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Playwright 가 오래 걸리므로 path 의 fetch 타임아웃 연장 (Next 15 는 기본 없음, 이 상수는 Vercel 용)
export const maxDuration = 300; // 5분 (Vercel Pro)

interface ScrapeBody {
  keyword?: string;
}

export async function POST(request: NextRequest) {
  await requireCompanyContext();

  let body: ScrapeBody;
  try {
    body = (await request.json()) as ScrapeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'JSON 본문이 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  const keyword = body.keyword?.trim();
  if (!keyword) {
    return NextResponse.json(
      { ok: false, error: '키워드가 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // 진행 로그는 서버 console.warn 으로 — lint 허용 레벨
  const result = await runSelloScrape(keyword, {
    onProgress: (m) => console.warn(`[api/scrape] ${m}`),
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      keyword: result.json.keyword,
      rowCount: result.json.rowCount,
      filledCount: result.json.filledCount,
      jsonPath: result.jsonPath,
    });
  }

  // 실패 분기 — HTTP 상태로 프런트에 의도 전달
  const statusMap: Record<typeof result.reason, number> = {
    'locked': HTTP_CONFLICT,
    'login-required': HTTP_PRECONDITION_FAILED,
    'launch-failed': HTTP_SERVICE_UNAVAILABLE,
    'timeout': HTTP_SERVICE_UNAVAILABLE,
    'other': HTTP_INTERNAL_SERVER_ERROR,
  };
  return NextResponse.json(
    { ok: false, reason: result.reason, error: result.error },
    { status: statusMap[result.reason] },
  );
}

/**
 * GET — 현재 락 상태 조회 (UI 에서 "다른 사람 스크래핑 중" 표시용).
 */
export async function GET() {
  await requireCompanyContext();
  const lock = getCurrentScrapeLock();
  return NextResponse.json({
    ok: true,
    isScraping: lock !== null,
    lock: lock
      ? {
          keyword: lock.keyword,
          startedAt: lock.startedAt,
          elapsedSec: Math.round((Date.now() - lock.startedAt) / 1000),
        }
      : null,
  });
}
