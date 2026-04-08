/**
 * 환경변수 점검 스크립트
 *
 * 출처: docs/SUPABASE_SETUP.md §2 (.env.local 설정)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * 역할:
 * - .env.local 에 필수 환경변수가 다 있는지 확인
 * - 형식 (URL, 길이, 포트) 검증
 * - 빠진 항목/잘못된 형식이 있으면 빨간색으로 경고하고 종료 코드 1
 *
 * 실행:
 *   npm run env:check
 *   또는: npx tsx --env-file=.env.local scripts/check-env.ts
 *
 * 종료 코드:
 *   0 = 모두 정상
 *   1 = 1개 이상 항목에 문제 있음
 */

// ────────────────────────────────────────────────────────────
// ANSI 색상 코드 (의존성 없이 터미널 색상 표현)
// ────────────────────────────────────────────────────────────
const COLOR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

// ────────────────────────────────────────────────────────────
// 점검 항목 정의
// ────────────────────────────────────────────────────────────
interface EnvCheck {
  key: string;
  required: boolean;
  description: string;
  /**
   * 추가 형식 검증. 문제가 있으면 에러 메시지(string), 정상이면 null.
   */
  validate?: (value: string) => string | null;
}

const MIN_AUTH_SECRET_LENGTH = 32;
const POOLER_PORT = '6543';
const DIRECT_PORT = '5432';

const CHECKS: EnvCheck[] = [
  // ── DB 연결
  {
    key: 'DATABASE_URL',
    required: true,
    description: '앱 런타임용 DB 연결 (Supabase 풀러, 포트 6543)',
    validate(value) {
      if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
        return 'postgresql:// 또는 postgres:// 로 시작해야 합니다.';
      }
      if (value.includes('placeholder')) {
        return 'placeholder 값입니다 — 실제 Supabase 연결 문자열로 교체하세요.';
      }
      // 풀러 포트(6543) 권장 (직접 연결 5432도 일단 통과는 시킴)
      if (!value.includes(`:${POOLER_PORT}/`) && !value.includes(`:${DIRECT_PORT}/`)) {
        return `포트가 ${POOLER_PORT} (풀러) 또는 ${DIRECT_PORT} (직접) 이어야 합니다.`;
      }
      return null;
    },
  },
  {
    key: 'DATABASE_URL_DIRECT',
    required: false,
    description: '마이그레이션·시드용 직접 연결 (Supabase 5432) — 선택',
    validate(value) {
      if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
        return 'postgresql:// 또는 postgres:// 로 시작해야 합니다.';
      }
      if (!value.includes(`:${DIRECT_PORT}/`)) {
        return `직접 연결은 포트 ${DIRECT_PORT} 이어야 합니다.`;
      }
      return null;
    },
  },

  // ── NextAuth
  {
    key: 'AUTH_SECRET',
    required: true,
    description: 'NextAuth JWT 서명 키 (최소 32바이트)',
    validate(value) {
      if (value.length < MIN_AUTH_SECRET_LENGTH) {
        return `최소 ${MIN_AUTH_SECRET_LENGTH}자 이상이어야 합니다 (현재 ${value.length}자).`;
      }
      if (/^(secret|test|placeholder|change[-_ ]?me)$/i.test(value)) {
        return '예시값을 그대로 쓰면 안 됩니다 — 진짜 랜덤 값으로 교체하세요.';
      }
      return null;
    },
  },

  // ── Supabase REST (선택)
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    required: false,
    description: 'Supabase REST API URL (클라이언트 직접 호출용 — 선택)',
    validate(value) {
      if (!value.startsWith('https://')) {
        return 'https:// 로 시작해야 합니다.';
      }
      if (!value.includes('.supabase.co')) {
        return '.supabase.co 도메인이어야 합니다.';
      }
      return null;
    },
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    required: false,
    description: 'Supabase anon public key (선택)',
  },

  // ── 시드 (선택)
  {
    key: 'SEED_ADMIN_PASSWORD',
    required: false,
    description: '시드 관리자 비밀번호 (없으면 BUYWISE!2026 기본값)',
    validate(value) {
      const MIN_LENGTH = 12;
      if (value.length < MIN_LENGTH) {
        return `운영용은 최소 ${MIN_LENGTH}자 이상 권장 (현재 ${value.length}자).`;
      }
      return null;
    },
  },

  // ── Anthropic API (C 단계 — 쿠팡 리뷰 분석용)
  {
    key: 'ANTHROPIC_API_KEY',
    required: false,
    description: 'Claude API 키 (쿠팡 리뷰 분석용 — C 단계 활성화 시 필요)',
    validate(value) {
      if (!value.startsWith('sk-ant-')) {
        return 'Anthropic 키는 sk-ant- 로 시작해야 합니다.';
      }
      return null;
    },
  },
];

// ────────────────────────────────────────────────────────────
// 점검 실행
// ────────────────────────────────────────────────────────────
interface CheckResult {
  key: string;
  status: 'ok' | 'missing' | 'invalid' | 'optional-missing';
  message?: string;
}

function runChecks(): CheckResult[] {
  return CHECKS.map((check) => {
    const value = process.env[check.key];

    if (value === undefined || value === '') {
      return {
        key: check.key,
        status: check.required ? 'missing' : 'optional-missing',
      };
    }

    if (check.validate) {
      const error = check.validate(value);
      if (error) {
        return { key: check.key, status: 'invalid', message: error };
      }
    }

    return { key: check.key, status: 'ok' };
  });
}

function printResults(results: CheckResult[]): void {
  const checksByKey = new Map(CHECKS.map((c) => [c.key, c]));

  console.log('');
  console.log(`${COLOR.bold}${COLOR.cyan}━━━ BUYWISE 환경변수 점검 ━━━${COLOR.reset}`);
  console.log('');

  for (const result of results) {
    const check = checksByKey.get(result.key);
    if (!check) continue;

    const label = `${result.key}`.padEnd(32);
    const desc = `${COLOR.gray}${check.description}${COLOR.reset}`;

    switch (result.status) {
      case 'ok':
        console.log(`  ${COLOR.green}✅${COLOR.reset} ${label} ${desc}`);
        break;
      case 'missing':
        console.log(`  ${COLOR.red}❌${COLOR.reset} ${label} ${desc}`);
        console.log(`     ${COLOR.red}→ 필수 항목입니다. .env.local에 추가하세요.${COLOR.reset}`);
        break;
      case 'invalid':
        console.log(`  ${COLOR.red}⚠️ ${COLOR.reset} ${label} ${desc}`);
        console.log(`     ${COLOR.red}→ ${result.message}${COLOR.reset}`);
        break;
      case 'optional-missing':
        console.log(`  ${COLOR.yellow}⊘${COLOR.reset}  ${label} ${desc}`);
        console.log(`     ${COLOR.yellow}→ 선택 항목 (지금은 없어도 OK).${COLOR.reset}`);
        break;
    }
  }

  // 요약
  const required = results.filter((r) => {
    const c = checksByKey.get(r.key);
    return c?.required ?? false;
  });
  const requiredOk = required.filter((r) => r.status === 'ok').length;
  const requiredFail = required.filter((r) => r.status !== 'ok').length;

  console.log('');
  console.log(`${COLOR.bold}━━━ 요약 ━━━${COLOR.reset}`);
  console.log(
    `  필수 항목: ${COLOR.green}${requiredOk}${COLOR.reset} / ${required.length} 통과` +
      (requiredFail > 0 ? `, ${COLOR.red}${requiredFail}개 실패${COLOR.reset}` : ''),
  );
  console.log('');

  if (requiredFail === 0) {
    console.log(`  ${COLOR.green}${COLOR.bold}✅ 모든 필수 항목이 준비됐습니다.${COLOR.reset}`);
    console.log(`  다음 명령으로 마이그레이션을 실행하세요:`);
    console.log(`     ${COLOR.cyan}npm run db:migrate${COLOR.reset}`);
    console.log(`     ${COLOR.cyan}npm run db:seed${COLOR.reset}`);
  } else {
    console.log(`  ${COLOR.red}${COLOR.bold}❌ 환경변수 설정이 미완료입니다.${COLOR.reset}`);
    console.log(`  자세한 가이드: ${COLOR.cyan}docs/SUPABASE_SETUP.md${COLOR.reset}`);
  }
  console.log('');
}

// ────────────────────────────────────────────────────────────
// 진입점
// ────────────────────────────────────────────────────────────
const results = runChecks();
printResults(results);

const checksByKey = new Map(CHECKS.map((c) => [c.key, c]));
const failed = results.filter((r) => {
  const c = checksByKey.get(r.key);
  return c?.required && r.status !== 'ok';
});

process.exit(failed.length > 0 ? 1 : 0);
