/**
 * Vitest 설정
 *
 * 역할:
 * - tsconfig.json의 `@/*` → `./src/*` 경로 별칭을 vitest가 인식하도록 함
 * - 기본 환경: node (브라우저 DOM 필요한 테스트는 별도 명시)
 * - .env.local 자동 로드
 *
 * 주의: 이 파일은 .config/.cjs/.mjs가 아닌 .ts 형식으로 작성.
 *      Vitest 4.x는 esbuild로 자체 트랜스파일하므로 별도 빌드 단계 불필요.
 */
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false, //                describe/it/expect 명시 import 강제 (가독성)
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
    // 모든 테스트 파일이 import 되기 전 더미 환경변수 주입 (DATABASE_URL 등)
    setupFiles: ['./src/test/setup.ts'],
    // 빈 테스트 파일 묵인 (스모크 1개라도 있으면 통과)
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/db/schema/**', //   순수 스키마 정의는 커버리지 제외
        'src/app/**', //         RSC 페이지는 통합 테스트 영역
      ],
    },
  },
});
