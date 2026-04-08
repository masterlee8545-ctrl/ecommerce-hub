/**
 * NextAuth.js v5 — Catch-all 라우트 핸들러
 *
 * 출처: NextAuth.js v5 공식 패턴
 *
 * 역할:
 * - /api/auth/signin, /api/auth/signout, /api/auth/session 등 모든 NextAuth 엔드포인트 처리
 * - GET / POST 모두 NextAuth가 자동 처리
 *
 * 주의:
 * - 이 파일은 Node runtime 전용 (auth.ts가 bcryptjs를 import 하므로)
 * - middleware는 별도로 Edge runtime에서 동작 (auth.config.ts만 사용)
 *
 * v5 패턴:
 * - auth.ts가 export 하는 handlers 객체에서 { GET, POST }를 구조 분해.
 */
import { handlers } from '@/lib/auth/auth';

export const { GET, POST } = handlers;
