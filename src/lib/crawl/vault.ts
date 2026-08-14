/**
 * 자격증명 금고 — 수집에 쓰는 쿠키·토큰을 한 곳에서 관리한다.
 *
 * 출처: market-research-toolkit 의 쿠키 금고(`cookies/store.json` + `sources/base.py`) 설계 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-7 (시크릿 노출 금지)
 *
 * ── 왜 한 곳으로 모으는가 ────────────────────────────────
 * 셀록홈즈 쿠키와 아이템스카우트 토큰이 각자 다른 방식으로 저장되고 있었다.
 * 셀록홈즈만 DB 에 저장돼 Vercel 인스턴스 간에 공유되고, 아이템스카우트는
 * 메모리와 파일뿐이라 **다른 인스턴스에서는 토큰이 안 보였다**
 * (원래 코드의 주석도 그 한계를 적어 두고 "추후 개선" 으로 남겨 뒀다).
 * 금고를 하나로 만들면서 두 자격증명이 같은 우선순위 규칙을 따르게 했다.
 *
 * ── 우선순위 ─────────────────────────────────────────────
 *   1. 메모리 (같은 인스턴스 안, 짧은 TTL)
 *   2. DB `system_settings` (인스턴스 간 공유 — 유일한 공유처)
 *   3. 파일 `.data/*.json` (로컬 개발 폴백)
 *   4. 환경변수 (최후 폴백)
 *
 * ⚠ 값은 **평문**으로 DB 와 파일에 저장된다. 이 값을 읽을 수 있으면 해당 계정에
 *   그대로 접근할 수 있다. 로그·에러 메시지에 값 자체를 절대 싣지 않는다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { systemSettings } from '@/db/schema';

/** 메모리 캐시 유효 시간. 짧게 잡아야 사용자가 갱신한 값이 곧바로 반영된다 */
const MEMORY_TTL_MS = 30_000;

/**
 * 자격증명 파일 폴더. 모듈 로드 시점에 cwd 를 굳히지 않는다
 * (`registry.ts` 의 같은 주석 참조 — 굳혀 두면 cwd 를 옮긴 뒤 옛 경로에 쓴다).
 */
function dataDir(): string {
  return path.join(process.cwd(), '.data');
}

// ─────────────────────────────────────────────────────────
// 자격증명 정의
// ─────────────────────────────────────────────────────────

export type CredentialName =
  | 'sellochomes_cookie'
  | 'sellochomes_visitor_id'
  | 'sellochomes_ga'
  | 'itemscout_token';

interface CredentialSpec {
  /** `system_settings.key` */
  dbKey: string;
  /** `.data/` 아래 파일명 */
  fileName: string;
  /** 환경변수명 */
  envVar: string;
  /** 사람이 읽을 이름 — 에러 메시지에 쓴다 */
  label: string;
  /** 없을 때 무엇을 하라고 안내할지 */
  hint: string;
  /**
   * 기존 파일 포맷의 키. 예전에 저장해 둔 `.data/*.json` 을 그대로 읽기 위해 남긴다.
   * 새로 쓸 때는 `value` 와 이 키를 함께 기록한다.
   */
  legacyFileKey: string | null;
  /**
   * 없어도 동작해야 하는 값의 기본값.
   * 브라우저 동반 쿠키처럼 "특정 계정 비밀이 아니지만 없으면 서버가 거부하는" 값에 쓴다.
   */
  fallback: string | null;
}

const SPECS: Record<CredentialName, CredentialSpec> = {
  sellochomes_cookie: {
    dbKey: 'sellochomes_cookie',
    fileName: 'sellochomes-cookie.json',
    envVar: 'SELLOCHOMES_COOKIE',
    label: '셀록홈즈 세션 쿠키(connect.sid)',
    hint: '설정 → 셀록홈즈 연결에서 쿠키를 입력하세요.',
    legacyFileKey: 'cookie',
    fallback: null,
  },
  sellochomes_visitor_id: {
    dbKey: 'sellochomes_visitor_id',
    fileName: 'sellochomes-visitor-id.json',
    envVar: 'SELLOCHOMES_VISITOR_ID',
    label: '셀록홈즈 방문자 식별자(sourcinglife_visitor_id)',
    hint: '없으면 셀록홈즈 백엔드가 쿠팡 응답을 돌려주지 않습니다.',
    legacyFileKey: null,
    // 원래 소스에 상수로 박혀 있던 게스트 값. 특정 계정의 비밀이 아니라
    // 백엔드가 요구하는 동반 쿠키라서 기본값으로 남긴다.
    fallback: 'guest_48674b7920c304cc5f095f081884b1ebe5980f833ecb905d59ad836097065ecf',
  },
  sellochomes_ga: {
    dbKey: 'sellochomes_ga',
    fileName: 'sellochomes-ga.json',
    envVar: 'SELLOCHOMES_GA',
    label: '셀록홈즈 동반 쿠키(_ga)',
    hint: '없으면 셀록홈즈 백엔드가 쿠팡 응답을 돌려주지 않습니다.',
    legacyFileKey: null,
    fallback: 'GA1.1.1450049607.1774702885',
  },
  itemscout_token: {
    dbKey: 'itemscout_token',
    fileName: 'itemscout-token.json',
    envVar: 'ITEMSCOUT_TOKEN',
    label: '아이템스카우트 토큰(i_token)',
    hint: '설정 → 아이템스카우트 연결에서 토큰을 입력하세요.',
    legacyFileKey: 'token',
    fallback: null,
  },
};

// ─────────────────────────────────────────────────────────
// 에러
// ─────────────────────────────────────────────────────────

/** 자격증명이 없을 때. 메시지에 값 자체는 절대 넣지 않는다 (P-7). */
export class CredentialMissingError extends Error {
  public readonly credential: CredentialName;

  constructor(credential: CredentialName, spec: CredentialSpec) {
    super(`[crawl/vault] ${spec.label} 이(가) 설정되지 않았습니다. ${spec.hint}`);
    this.name = 'CredentialMissingError';
    this.credential = credential;
  }
}

/** 자격증명 저장 실패. */
export class CredentialSaveError extends Error {
  public readonly credential: CredentialName;

  constructor(credential: CredentialName, cause: string) {
    super(`[crawl/vault] ${SPECS[credential].label} 저장 실패: ${cause}`);
    this.name = 'CredentialSaveError';
    this.credential = credential;
  }
}

// ─────────────────────────────────────────────────────────
// 메모리 캐시
// ─────────────────────────────────────────────────────────

declare global {
  var __crawlVaultCache: Map<string, { value: string; cachedAt: number }> | undefined;
}

function cache(): Map<string, { value: string; cachedAt: number }> {
  if (!globalThis.__crawlVaultCache) globalThis.__crawlVaultCache = new Map();
  return globalThis.__crawlVaultCache;
}

/** 캐시를 비운다. 값을 갱신했는데 옛 값이 물려 있을 때 쓴다. */
export function clearCredentialCache(name?: CredentialName): void {
  if (name) cache().delete(name);
  else cache().clear();
}

// ─────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────

async function readFromDb(spec: CredentialSpec): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, spec.dbKey))
      .limit(1);
    return rows[0]?.value ?? null;
  } catch (err) {
    // 마이그레이션 미적용이나 연결 실패 — 폴백 체인을 계속 탄다.
    // 조용히 넘기면 "왜 DB 값이 안 보이지"를 아무도 모르므로 경고는 남긴다.
    console.warn(
      `[crawl/vault] ${spec.label} DB 조회 실패 (마이그레이션 미적용 가능): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function readFromFile(spec: CredentialSpec): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dataDir(), spec.fileName), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const direct = parsed['value'];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    if (spec.legacyFileKey) {
      const legacy = parsed[spec.legacyFileKey];
      if (typeof legacy === 'string' && legacy.length > 0) return legacy;
    }
    return null;
  } catch {
    return null; // 파일이 없는 게 정상 상태다
  }
}

/**
 * 자격증명 값을 읽는다. 어디에도 없으면 던진다 (P-2 — 빈 값으로 계속 진행하지 않는다).
 */
export async function getCredential(name: CredentialName): Promise<string> {
  const spec = SPECS[name];

  const hit = cache().get(name);
  if (hit && Date.now() - hit.cachedAt < MEMORY_TTL_MS) return hit.value;

  const fromDb = await readFromDb(spec);
  if (fromDb) {
    cache().set(name, { value: fromDb, cachedAt: Date.now() });
    return fromDb;
  }

  const fromFile = await readFromFile(spec);
  if (fromFile) {
    cache().set(name, { value: fromFile, cachedAt: Date.now() });
    return fromFile;
  }

  const fromEnv = process.env[spec.envVar];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  if (spec.fallback !== null) return spec.fallback;

  throw new CredentialMissingError(name, spec);
}

/** 값이 있는지만 확인한다 (설정 화면의 연결 상태 표시용). */
export async function hasCredential(name: CredentialName): Promise<boolean> {
  try {
    await getCredential(name);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────

/**
 * 자격증명을 저장한다.
 *
 * DB 저장이 실패하면 던진다 — Vercel 다중 인스턴스에서는 DB 가 유일한 공유처라,
 * 여기서 실패한 걸 삼키면 사용자는 "저장했다"고 믿는데 다른 인스턴스에서는
 * 계속 옛 값을 쓰는 상태가 된다.
 */
export async function saveCredential(name: CredentialName, value: string): Promise<void> {
  const spec = SPECS[name];
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CredentialSaveError(name, '빈 값은 저장할 수 없습니다.');
  }

  try {
    await db
      .insert(systemSettings)
      .values({ key: spec.dbKey, value: trimmed })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: trimmed, updatedAt: new Date() },
      });
  } catch (err) {
    throw new CredentialSaveError(
      name,
      `${err instanceof Error ? err.message : String(err)} — 마이그레이션(0008_system_settings) 적용 여부를 확인하세요.`,
    );
  }

  cache().set(name, { value: trimmed, cachedAt: Date.now() });

  // 파일은 로컬 개발 편의용. Vercel 은 읽기 전용이라 실패가 정상이다.
  try {
    await mkdir(dataDir(), { recursive: true });
    const body: Record<string, string> = { value: trimmed };
    if (spec.legacyFileKey) body[spec.legacyFileKey] = trimmed;
    await writeFile(
      path.join(dataDir(), spec.fileName),
      `${JSON.stringify(body, null, 2)}\n`,
      'utf-8',
    );
  } catch {
    // DB 가 source of truth 이므로 파일 실패는 넘어간다
  }
}
