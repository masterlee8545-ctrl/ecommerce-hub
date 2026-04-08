/**
 * PostCSS 설정
 *
 * Tailwind CSS 3.4 + Autoprefixer 표준 조합.
 * Next.js 15는 이 파일을 자동으로 인식해 빌드 시 globals.css를 처리한다.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
