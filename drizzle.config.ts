/**
 * Drizzle Kit 설정 파일
 *
 * 역할:
 * - DB 표(테이블) 설계도(`src/db/schema/`)를 SQL 마이그레이션으로 변환
 * - DB 직접 연결 (`db:push`, `db:studio`)
 *
 * 헌법 준수:
 * - CLAUDE.md §1 P-7: DATABASE_URL은 .env.local에서만 로드 (코드 하드코딩 금지)
 * - CLAUDE.md §1 P-2: 환경변수 누락 시 조용히 계속 진행 금지 → 명시적 throw
 * - CLAUDE.md §1 P-6: 마이그레이션은 새 파일로만 추가 (옛 파일 수정 금지)
 *
 * 출처: drizzle-kit 0.31.10 공식 API (defineConfig)
 */
import { defineConfig } from 'drizzle-kit';

// ─────────────────────────────────────────────────────────────
// .env.local 로드 (Node.js 21+ 내장 기능, 외부 dotenv 의존 없음)
// ─────────────────────────────────────────────────────────────
try {
  // process.loadEnvFile은 Node 21+ 표준. 우리는 v24.14.0이라 안전.
  process.loadEnvFile('.env.local');
} catch (err) {
  // .env.local이 없는 환경 (CI, Vercel 등)에서는 무시
  if (process.env['NODE_ENV'] !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[drizzle.config] .env.local not found, falling back to process.env');
  }
}

// ─────────────────────────────────────────────────────────────
// DATABASE_URL 명시적 검증 (P-2: 추측 금지, 누락 시 즉시 throw)
// ─────────────────────────────────────────────────────────────
const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) {
  throw new Error(
    [
      'DATABASE_URL 환경변수가 설정되지 않았습니다.',
      '',
      '조치:',
      '1. .env.local 파일이 프로젝트 루트에 있는지 확인',
      '2. .env.local.example §1 Database 섹션 참고하여 DATABASE_URL 채우기',
      '3. Supabase 프로젝트 → Settings → Database → Connection string (URI)에서 복사',
      '',
      '관련 헌법: CLAUDE.md §1 P-7 (.env.local 커밋 금지)',
    ].join('\n'),
  );
}

// ─────────────────────────────────────────────────────────────
// Drizzle Kit 설정
// ─────────────────────────────────────────────────────────────
export default defineConfig({
  // 표 정의 위치 (re-export 진입점)
  schema: './src/db/schema/index.ts',

  // 마이그레이션 SQL 파일 출력 위치
  // (drizzle/meta는 .gitignore, drizzle/migrations만 커밋 — 헌법 P-6)
  out: './drizzle/migrations',

  // PostgreSQL (Supabase 공식)
  dialect: 'postgresql',

  dbCredentials: {
    url: dbUrl,
  },

  // 마이그레이션 생성 시 상세 로그
  verbose: true,

  // 잠재적 데이터 손실 작업 시 사용자 확인 프롬프트
  strict: true,

  // 마이그레이션 메타데이터 폴더 이름
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
