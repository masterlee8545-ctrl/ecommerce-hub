/**
 * /api/health — 시스템 헬스체크 API
 *
 * 출처: 모니터링 표준 패턴
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 — 응답에 한국어 메시지 포함)
 *
 * 역할:
 * - DB 연결 상태 확인 (postgres ping)
 * - 응답 시간 측정
 * - 인증 없이 호출 가능 (PUBLIC_PATHS 포함)
 *
 * 사용처:
 * - Vercel/UptimeRobot 등 외부 모니터링
 * - 배포 직후 스모크 테스트
 *
 * 응답:
 * - 200 OK: { ok: true, db: { ok: true, latencyMs: 12 }, timestamp }
 * - 503 Service Unavailable: { ok: false, db: { ok: false, ... } }
 */
import { NextResponse } from 'next/server';

import { checkDbHealth } from '@/db';

// HTTP 상태 코드 상수 (매직 넘버 회피)
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

// 매 요청마다 새로 측정 (캐시 금지)
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = new Date().toISOString();

  let db: { ok: boolean; latencyMs: number };
  try {
    db = await checkDbHealth();
  } catch {
    db = { ok: false, latencyMs: 0 };
  }

  const ok = db.ok;
  const status = ok ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE;

  return NextResponse.json(
    {
      ok,
      message: ok ? '시스템 정상' : '데이터베이스 연결 실패',
      db,
      timestamp: startedAt,
    },
    { status },
  );
}
