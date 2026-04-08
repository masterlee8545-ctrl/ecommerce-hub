/**
 * Next.js 설정 파일
 *
 * 헌법 준수:
 * - CLAUDE.md §2 Q2: typecheck/lint 강제 (빌드 시 우회 금지)
 * - CLAUDE.md §1 P-2: 이미지 도메인은 실제 사용 시점에 추가 (추측 금지)
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // React Strict Mode — 잠재적 문제 조기 감지
  reactStrictMode: true,

  // 빌드 시 TypeScript 오류 무시 금지 (헌법 §2 Q2)
  typescript: {
    ignoreBuildErrors: false,
  },

  // 빌드 시 ESLint 오류 무시 금지 (헌법 §2 Q2)
  eslint: {
    ignoreDuringBuilds: false,
  },

  // 외부 이미지 도메인
  // 추가는 실제 사용 시점에 명시적으로 진행 (헌법 P-2 추측 금지)
  // 추후 추가 예정: 1688 cdn, 쿠팡 cdn, 네이버 스마트스토어 cdn
  images: {
    remotePatterns: [],
  },

  // experimental 옵션은 안정성 우선으로 비활성 (Phase 2에서 검토)
  experimental: {},

  // 프로덕션 빌드 시 console.* 제거 (warn/error 제외, ESLint와 일치)
  compiler: {
    removeConsole: {
      exclude: ['warn', 'error'],
    },
  },
};

export default nextConfig;
