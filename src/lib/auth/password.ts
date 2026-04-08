/**
 * 비밀번호 해시/검증 헬퍼 (bcryptjs)
 *
 * 출처: docs/DATA_MODEL.md §2.2 (users.password_hash 명세)
 * 헌법: CLAUDE.md §1 P-7 (비밀번호 평문 저장 금지), §1 P-2 (실패 시 throw)
 *
 * 역할:
 * - 사용자 비밀번호를 안전하게 해시 (bcrypt cost ≥ 12)
 * - 로그인 시 해시 비교
 *
 * 보안 결정:
 * - bcryptjs (순수 JS) — 네이티브 bcrypt 대비 느리지만 Vercel/Edge 호환
 * - cost 12 — 2026년 기준 안전 (1초당 1회 ~ 0.1초당 1회 검증 속도)
 * - 평문 비밀번호는 절대 함수 외부로 노출 금지 (스택트레이스에도 안 남도록)
 */
import { compare, hash } from 'bcryptjs';

/**
 * bcrypt cost factor (rounds).
 * 2026년 권장값: 12.
 * 12 = 약 0.25초/회, 14 = 약 1초/회.
 */
export const BCRYPT_COST = 12;

/**
 * 비밀번호 최소 길이 (8자) — UX 균형.
 * 권장은 더 길지만, 사용자가 처음 가입할 때 거부감 최소화.
 * 추후 NIST 권장 (passphrase)으로 확장 가능.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 비밀번호 최대 길이 (72자) — bcrypt 알고리즘 한계.
 * bcrypt는 72바이트 이상은 잘라버리므로, 잘림을 방지하기 위해 명시적으로 제한.
 */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * 사용자가 입력한 비밀번호의 형식이 유효한지 검사.
 *
 * @returns null = 유효 / string = 오류 메시지
 */
export function validatePasswordFormat(password: string): string | null {
  if (typeof password !== 'string') {
    return '비밀번호는 문자열이어야 합니다.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `비밀번호는 최대 ${MAX_PASSWORD_LENGTH}자까지 가능합니다.`;
  }
  return null;
}

/**
 * 평문 비밀번호를 bcrypt 해시로 변환.
 *
 * 사용처: 회원가입, 비밀번호 변경, 시드 데이터 생성
 *
 * @throws 비밀번호 형식이 유효하지 않거나 해시 생성에 실패하면 throw
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  const validationError = validatePasswordFormat(plainPassword);
  if (validationError) {
    throw new Error(`[hashPassword] ${validationError}`);
  }
  return hash(plainPassword, BCRYPT_COST);
}

/**
 * 평문 비밀번호와 저장된 해시를 비교.
 *
 * 사용처: 로그인 (NextAuth Credentials provider authorize 함수)
 *
 * 주의:
 * - 빈 문자열, null, undefined가 들어와도 false 반환 (throw 하지 않음)
 *   → 로그인 실패는 throw가 아니라 false로 표현 (NextAuth 표준)
 * - 타이밍 공격 방지: bcrypt.compare가 자체적으로 일정 시간 보장
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string,
): Promise<boolean> {
  if (!plainPassword || !storedHash) {
    return false;
  }
  // 형식 검증 실패도 false (로그인 실패 통합 처리)
  if (validatePasswordFormat(plainPassword) !== null) {
    return false;
  }
  try {
    return await compare(plainPassword, storedHash);
  } catch {
    // 해시 형식이 잘못된 경우 등 — 로그인 실패로 처리
    return false;
  }
}
