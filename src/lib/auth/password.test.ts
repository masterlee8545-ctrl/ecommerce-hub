/**
 * 비밀번호 헬퍼 단위 테스트
 *
 * 출처: src/lib/auth/password.ts
 * 헌법: CLAUDE.md §1 P-7 (비밀번호 평문 금지), §1 P-2 (실패 시 명시적 에러)
 *
 * 검증 항목:
 * 1. validatePasswordFormat — 길이/타입 거부
 * 2. hashPassword — 형식 검증 + 해시 결과 ($2 prefix + cost 12)
 * 3. verifyPassword — 정답/오답/빈값/잘못된 해시 모두 처리
 * 4. 라운드트립 — hash → verify 가 항상 true
 *
 * 이 테스트는 빠르게 실행되어야 한다 — bcrypt cost 12는 약 0.25초/회.
 * 따라서 라운드트립은 최소화하고, 가능하면 미리 만든 해시를 재사용한다.
 */
import { describe, expect, it } from 'vitest';

import {
  BCRYPT_COST,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  validatePasswordFormat,
  verifyPassword,
} from './password';

// ─────────────────────────────────────────────────────────
// 사전 계산된 해시 (테스트 속도 최적화)
// ─────────────────────────────────────────────────────────
// bcrypt cost 12로 'CorrectPassword!2026'을 해시한 결과.
// 이 값은 매번 새로 만들면 ~0.25초/회 소요되므로 정적으로 보관.
// (해시는 salt 포함이라 매번 다른 값이 나오지만, verify는 동일하게 작동)
const KNOWN_PLAINTEXT = 'CorrectPassword!2026';

// ─────────────────────────────────────────────────────────
// 1. 상수 검증
// ─────────────────────────────────────────────────────────
describe('password — 상수', () => {
  it('BCRYPT_COST는 12 이상 (2026년 권장값)', () => {
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });

  it('MIN_PASSWORD_LENGTH는 최소 8자', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('MAX_PASSWORD_LENGTH는 bcrypt 한계 72자', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(72);
  });
});

// ─────────────────────────────────────────────────────────
// 2. validatePasswordFormat — 입력 검증
// ─────────────────────────────────────────────────────────
describe('validatePasswordFormat', () => {
  it('정상 비밀번호는 null 반환', () => {
    expect(validatePasswordFormat('Validpass123!')).toBeNull();
  });

  it('정확히 8자는 통과 (경계값)', () => {
    expect(validatePasswordFormat('Pass123!')).toBeNull();
  });

  it('정확히 72자는 통과 (경계값)', () => {
    const password = 'A'.repeat(72);
    expect(validatePasswordFormat(password)).toBeNull();
  });

  it('7자는 거부 (최소 길이 미달)', () => {
    const result = validatePasswordFormat('Short1!');
    expect(result).toContain('최소');
  });

  it('73자는 거부 (최대 길이 초과)', () => {
    const password = 'A'.repeat(73);
    const result = validatePasswordFormat(password);
    expect(result).toContain('최대');
  });

  it('빈 문자열은 거부', () => {
    const result = validatePasswordFormat('');
    expect(result).not.toBeNull();
  });

  it('숫자 타입은 거부 (런타임 가드)', () => {
    // 의도적으로 잘못된 타입 — JS에서 들어올 수 있는 케이스 방어
    const result = validatePasswordFormat(12_345_678 as unknown as string);
    expect(result).toContain('문자열');
  });
});

// ─────────────────────────────────────────────────────────
// 3. hashPassword — 해시 생성
// ─────────────────────────────────────────────────────────
describe('hashPassword', () => {
  it('정상 비밀번호 → bcrypt 해시 반환 ($2로 시작)', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    expect(hash).toMatch(/^\$2[aby]\$/); // $2a, $2b, $2y 모두 허용
  });

  it('해시에 cost 12가 포함되어 있음', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    // bcrypt 해시 형식: $2[aby]$<cost>$<salt><hash>
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('너무 짧은 비밀번호는 throw', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/최소/);
  });

  it('너무 긴 비밀번호는 throw', async () => {
    await expect(hashPassword('A'.repeat(100))).rejects.toThrow(/최대/);
  });
});

// ─────────────────────────────────────────────────────────
// 4. verifyPassword — 검증
// ─────────────────────────────────────────────────────────
describe('verifyPassword', () => {
  it('hash → verify 라운드트립 성공', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    const isValid = await verifyPassword(KNOWN_PLAINTEXT, hash);
    expect(isValid).toBe(true);
  });

  it('잘못된 비밀번호는 false', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    const isValid = await verifyPassword('WrongPassword!', hash);
    expect(isValid).toBe(false);
  });

  it('빈 평문은 false (throw 하지 않음)', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    const isValid = await verifyPassword('', hash);
    expect(isValid).toBe(false);
  });

  it('빈 해시는 false (throw 하지 않음)', async () => {
    const isValid = await verifyPassword(KNOWN_PLAINTEXT, '');
    expect(isValid).toBe(false);
  });

  it('잘못된 해시 형식은 false (throw 하지 않음)', async () => {
    const isValid = await verifyPassword(KNOWN_PLAINTEXT, 'not-a-bcrypt-hash');
    expect(isValid).toBe(false);
  });

  it('형식 검증 실패한 비밀번호는 false (로그인 통합 처리)', async () => {
    const hash = await hashPassword(KNOWN_PLAINTEXT);
    // 너무 짧은 비밀번호는 hashPassword와 달리 verifyPassword에서는 throw 안 함
    const isValid = await verifyPassword('short', hash);
    expect(isValid).toBe(false);
  });

  it('서로 다른 평문에 대한 해시는 서로 검증되지 않음', async () => {
    const hash1 = await hashPassword('PasswordOne!2026');
    const isValid = await verifyPassword('PasswordTwo!2026', hash1);
    expect(isValid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// 5. 보안 속성 — salt 검증
// ─────────────────────────────────────────────────────────
describe('password — 보안 속성', () => {
  it('같은 평문이라도 매번 다른 해시 (salt 동작)', async () => {
    const hash1 = await hashPassword(KNOWN_PLAINTEXT);
    const hash2 = await hashPassword(KNOWN_PLAINTEXT);
    expect(hash1).not.toBe(hash2);

    // 그래도 둘 다 verify는 통과해야 함
    expect(await verifyPassword(KNOWN_PLAINTEXT, hash1)).toBe(true);
    expect(await verifyPassword(KNOWN_PLAINTEXT, hash2)).toBe(true);
  });
});
