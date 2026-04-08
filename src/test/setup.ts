/**
 * Vitest 글로벌 셋업 — 모든 테스트 파일 import 전에 1회 실행됨
 *
 * 출처: vitest.config.ts → test.setupFiles
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시), P-9 (사용자 친화)
 *
 * 역할:
 * - DB 연결을 시도하지 않는 단위 테스트가 @/db 모듈 import 시점에 크래시하지 않도록
 *   더미 DATABASE_URL을 주입한다.
 * - 실제 DB 호출은 단위 테스트에서 일어나지 않는다 — withCompanyContext 안의
 *   실제 쿼리는 통합/E2E 테스트에서 검증한다.
 * - .env.local에 진짜 값이 이미 있으면 그것을 우선 사용 (덮어쓰지 않음).
 *
 * 안전성:
 * - 더미 URL은 절대 실제 호스트를 가리키지 않음 (postgres://test@localhost:1/test)
 * - 단위 테스트는 입력 검증 분기에서만 멈추므로 connect 단계까지 가지 않음
 */

if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'postgres://test:test@localhost:1/test_db';
}

if (!process.env['NEXTAUTH_SECRET']) {
  process.env['NEXTAUTH_SECRET'] = 'test-secret-do-not-use-in-production-this-is-vitest-only';
}
