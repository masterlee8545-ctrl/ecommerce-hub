/**
 * DB 클라이언트 (Drizzle ORM + postgres-js)
 *
 * 출처: docs/DATA_MODEL.md §0.3 (RLS), §7 (RLS 정책 템플릿)
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 격리 강제)
 *
 * 역할:
 * - postgres 연결 풀 싱글톤 (모듈 로드 시 1회만 생성)
 * - drizzle ORM 인스턴스 노출 (모든 쿼리는 이 db 객체 통과)
 * - 멀티테넌트 RLS 컨텍스트 헬퍼 (withCompanyContext)
 *
 * 멀티테넌트 동작 원리:
 * 1. 매 요청마다 인증된 사용자의 회사 ID가 결정된다 (NextAuth 미들웨어)
 * 2. withCompanyContext(companyId, fn) 안에서 쿼리 실행
 * 3. 트랜잭션 내부에서 `SET LOCAL app.current_company_id = '...'` 실행
 * 4. RLS 정책이 current_setting('app.current_company_id')을 읽어 다른 회사 데이터 자동 차단
 *
 * 핵심 제약 (P-4):
 * - 회사 컨텍스트 없이는 절대 멀티테넌트 표를 쿼리할 수 없다.
 * - 시스템 작업(시드, 마이그레이션)만 db.* 직접 사용 허용.
 * - 일반 비즈니스 로직은 반드시 withCompanyContext 통과.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

// ───────────────────────────────────────────────────────────
// 환경변수 검증 (모듈 로드 시점)
// ───────────────────────────────────────────────────────────
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error(
    '[db] DATABASE_URL 환경변수가 설정되지 않았습니다.\n' +
      '  .env.local 파일에 DATABASE_URL을 추가하세요.\n' +
      '  형식: postgresql://postgres:[password]@[host]:5432/postgres',
  );
}

// ───────────────────────────────────────────────────────────
// postgres-js 연결 풀 (싱글톤)
// ───────────────────────────────────────────────────────────
// Next.js 개발 모드에서 hot-reload 시 중복 연결 방지를 위해 globalThis 캐시 사용
declare global {
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

const pgClient =
  globalThis.__pgClient ??
  postgres(DATABASE_URL, {
    // 개발 환경 권장 설정
    max: 10, //                   동시 연결 풀 최대 크기
    idle_timeout: 20, //          유휴 연결 종료 (초)
    connect_timeout: 10, //       연결 타임아웃 (초)
    prepare: false, //            Supabase 트랜잭션 풀러 호환 (port 6543)
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__pgClient = pgClient;
}

// ───────────────────────────────────────────────────────────
// Drizzle ORM 인스턴스
// ───────────────────────────────────────────────────────────
/**
 * 시스템 레벨 DB 클라이언트.
 *
 * ⚠️ 주의: 이것은 RLS 컨텍스트가 설정되지 않은 raw 클라이언트다.
 * 비즈니스 로직에서는 반드시 withCompanyContext()를 통과해야 한다 (P-4).
 *
 * 직접 사용 허용 케이스:
 * - 마이그레이션 / 시드 스크립트
 * - 인증 (users/user_companies 표 — RLS 미적용)
 * - 시스템 cron 작업 (companyId를 명시적으로 전달)
 */
export const db = drizzle(pgClient, { schema });

// 스키마 타입 재노출 (다른 파일에서 import { type Product } from '@/db' 가능)
export * from './schema';

// ───────────────────────────────────────────────────────────
// 멀티테넌트 컨텍스트 헬퍼 (P-4 강제)
// ───────────────────────────────────────────────────────────
/**
 * 회사 컨텍스트 안에서 콜백을 실행한다.
 *
 * 트랜잭션을 시작하고 SET LOCAL로 app.current_company_id를 설정한 뒤,
 * RLS 정책이 자동으로 다른 회사 데이터를 차단한다.
 *
 * @param companyId 현재 회사 UUID (NextAuth 세션에서 추출)
 * @param fn 트랜잭션 내부에서 실행할 콜백 (tx 전달)
 *
 * @example
 * ```ts
 * const products = await withCompanyContext(session.user.activeCompanyId, async (tx) => {
 *   return tx.select().from(products).where(eq(products.status, 'sourcing'));
 * });
 * ```
 */
export async function withCompanyContext<T>(
  companyId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  // UUID 형식 1차 검증 (SQL 인젝션 방지)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
    throw new Error(`[withCompanyContext] 유효하지 않은 companyId 형식: ${companyId}`);
  }

  return db.transaction(async (tx) => {
    // SET LOCAL은 트랜잭션 종료 시 자동 해제 — 다른 요청에 영향 없음
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

// ───────────────────────────────────────────────────────────
// 헬스체크 (모니터링용)
// ───────────────────────────────────────────────────────────
/**
 * DB 연결 상태 확인.
 * /api/health 엔드포인트에서 사용.
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
