/**
 * 셀렉터 레지스트리 — 로드 / 조회 / 승격 / 이력 / 되돌리기.
 *
 * 출처: market-research-toolkit `registry/loader.py` 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-6 (기존 기록 파괴 금지)
 *
 * ── 저장 위치가 두 곳인 이유 ─────────────────────────────
 * 기준 파일 `src/lib/crawl/selectors.json` 은 **import 로 읽는다.**
 * Vercel 은 파일시스템이 읽기 전용이라 런타임에 못 읽는 경로가 생기는데,
 * import 는 번들에 들어가므로 어디서든 확실히 읽힌다.
 *
 * 치유로 바뀐 값은 `data/crawl-registry/selectors.local.json` 에 덧씌운다.
 * 치유는 브라우저를 띄울 수 있는 **로컬 워커에서만** 일어나므로 쓰기가 가능하다.
 * 로드 시 기준 파일 위에 이 덮개를 병합한다.
 *
 * 덮개에 쌓인 변경은 `npm run crawl:promote` 결과를 보고 사람이 기준 파일에
 * 반영(커밋)한다. 자동으로 소스를 고쳐 커밋하지 않는 이유는, 셀렉터 변경이
 * 코드 리뷰를 거치지 않고 배포되면 안 되기 때문이다.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import baseRegistry from './selectors.json';

import type {
  HealStage,
  HistoryRecord,
  SelectorEntry,
  SelectorRegistryFile,
} from './types';

// ─────────────────────────────────────────────────────────
// 스키마 — 기준 파일과 덮개 파일 모두 이걸 통과해야 쓰인다
// ─────────────────────────────────────────────────────────

// `.strict()` 가 핵심이다. 두 계약 모두 필드가 전부 선택이라, 느슨하게 두면
// JSON 계약이 CSS 스키마에 먼저 매치돼 `status`·`jsonKeys` 가 **조용히 깎여** 나간다.
// (그러면 응답 계약이 전부 빈 계약이 되어 아무것도 검증하지 못한다.)
// 덤으로, 오타 난 계약 키도 여기서 걸린다 — 계약이 틀리면 자동 치유의 근거가 무너진다.
const cssContractSchema = z
  .object({
    minMatches: z.number().int().positive().optional(),
    attr: z.string().min(1).optional(),
    mustMatch: z.string().min(1).optional(),
    minTextLen: z.number().int().nonnegative().optional(),
  })
  .strict();

const jsonContractSchema = z
  .object({
    status: z.number().int().optional(),
    jsonKeys: z.array(z.string().min(1)).optional(),
  })
  .strict();

const entryBase = {
  primary: z.string().min(1),
  fallbacks: z.array(z.string().min(1)),
  within: z.string().min(1).nullable(),
  description: z.string().min(1),
  sampleUrls: z.array(z.string().min(1)),
  requiresBrowser: z.boolean(),
  healedAt: z.string().min(1).nullable(),
  healedFrom: z.string().min(1).nullable(),
};

// `kind` 로 갈라 계약 모양까지 맞춘다. 그냥 union 으로 두면 css 항목에 `jsonKeys` 를
// 적어 놔도 통과해 버려, 아무것도 검증하지 못하는 계약이 조용히 생긴다.
const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('css'), contract: cssContractSchema, ...entryBase }),
  z.object({ kind: z.literal('json'), contract: jsonContractSchema, ...entryBase }),
]);

const registryFileSchema = z.object({
  version: z.number().int().positive(),
  selectors: z.record(z.string().min(1), entrySchema),
});

// ─────────────────────────────────────────────────────────
// 경로
// ─────────────────────────────────────────────────────────

/** 깨진 이력 줄을 경고에 실을 때 보여 줄 길이. */
const HISTORY_PREVIEW_CHARS = 80;

/**
 * 경로는 **쓸 때마다 계산한다.** 모듈 로드 시점에 `process.cwd()` 를 굳혀 두면,
 * 그 뒤 cwd 를 옮겨도 옛 경로에 계속 쓴다.
 *
 * 실제로 이걸로 사고가 났다: 연기 점검(`npm run crawl:smoke`)이 저장소를 건드리지
 * 않으려고 임시 폴더로 cwd 를 옮겼는데, 경로가 이미 굳어 있어 **저장소의 레지스트리를
 * 가짜 셀렉터로 덮어썼다.** 지연 계산이면 애초에 생기지 않는 문제다.
 */
function overlayDir(): string {
  return path.join(process.cwd(), 'data', 'crawl-registry');
}

/** 치유 결과를 덮어쓸 파일 경로 — 안내 메시지에 쓴다. */
export function overlayPath(): string {
  return path.join(overlayDir(), 'selectors.local.json');
}

/** 변경 이력 파일 경로. */
export function historyPath(): string {
  return path.join(overlayDir(), 'history.jsonl');
}

// ─────────────────────────────────────────────────────────
// 에러
// ─────────────────────────────────────────────────────────

/** 레지스트리 조작 실패. 조용히 넘어가지 않기 위해 전용 타입을 둔다 (P-2). */
export class RegistryError extends Error {
  public readonly code: 'unknown_selector' | 'invalid_file' | 'read_only' | 'no_history';

  constructor(
    message: string,
    code: 'unknown_selector' | 'invalid_file' | 'read_only' | 'no_history',
  ) {
    super(`[crawl/registry] ${message}`);
    this.name = 'RegistryError';
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────
// 로드
// ─────────────────────────────────────────────────────────

let cached: SelectorRegistryFile | null = null;

function parseFile(raw: unknown, source: string): SelectorRegistryFile {
  const parsed = registryFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RegistryError(
      `${source} 형식이 스키마와 다릅니다: ${parsed.error.message}`,
      'invalid_file',
    );
  }
  return parsed.data as SelectorRegistryFile;
}

async function readOverlay(): Promise<Partial<Record<string, SelectorEntry>>> {
  let text: string;
  try {
    text = await readFile(overlayPath(), 'utf-8');
  } catch {
    return {}; // 덮개가 없는 게 정상 상태다 (치유가 한 번도 없었음)
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new RegistryError(
      `${overlayPath()} 이 올바른 JSON 이 아닙니다: ${err instanceof Error ? err.message : String(err)}`,
      'invalid_file',
    );
  }
  return parseFile(raw, overlayPath()).selectors;
}

/**
 * 레지스트리를 읽는다 (기준 파일 + 덮개 병합).
 *
 * 한 프로세스 안에서 캐시한다. 치유가 일어나면 캐시를 갱신한다.
 */
export async function loadRegistry(): Promise<SelectorRegistryFile> {
  if (cached) return cached;

  const base = parseFile(baseRegistry, 'src/lib/crawl/selectors.json');
  const overlay = await readOverlay();

  const merged: Record<string, SelectorEntry> = { ...base.selectors };
  for (const [id, entry] of Object.entries(overlay)) {
    if (!entry) continue;
    if (!(id in merged)) {
      // 기준 파일에 없는 id 가 덮개에만 있으면 기준 파일이 되돌려진 상태다.
      // 조용히 살려두면 코드에 없는 셀렉터가 유령처럼 남으므로 건너뛴다.
      continue;
    }
    merged[id] = entry;
  }

  cached = { version: base.version, selectors: merged };
  return cached;
}

/** 캐시를 비운다 (테스트/치유 후 재로드용). */
export function resetRegistryCache(): void {
  cached = null;
}

/** 셀렉터 한 건. 없으면 던진다 — 오타를 조용히 넘기지 않기 위해서다. */
export async function getEntry(selectorId: string): Promise<SelectorEntry> {
  const registry = await loadRegistry();
  const entry = registry.selectors[selectorId];
  if (!entry) {
    throw new RegistryError(
      `등록되지 않은 셀렉터 id 입니다: ${selectorId}. src/lib/crawl/selectors.json 을 확인하세요.`,
      'unknown_selector',
    );
  }
  return entry;
}

/** 등록된 모든 셀렉터 id. */
export async function selectorIds(): Promise<string[]> {
  const registry = await loadRegistry();
  return Object.keys(registry.selectors);
}

/** 특정 접두사(소스)로 시작하는 셀렉터 id 들. 예: `sello.` */
export async function selectorIdsByPrefix(prefix: string): Promise<string[]> {
  const ids = await selectorIds();
  return ids.filter((id) => id.startsWith(prefix));
}

// ─────────────────────────────────────────────────────────
// 승격 / 되돌리기
// ─────────────────────────────────────────────────────────

async function writeOverlay(selectors: Record<string, SelectorEntry>): Promise<void> {
  try {
    await mkdir(overlayDir(), { recursive: true });
    const body: SelectorRegistryFile = { version: 1, selectors };
    await writeFile(overlayPath(), `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
  } catch (err) {
    throw new RegistryError(
      `치유 결과를 저장할 수 없습니다 (${overlayPath()}). ` +
        '읽기 전용 파일시스템(Vercel 등)에서는 치유가 불가능합니다. ' +
        `로컬 워커에서 실행하세요. 원인: ${err instanceof Error ? err.message : String(err)}`,
      'read_only',
    );
  }
}

async function appendHistory(record: HistoryRecord): Promise<void> {
  try {
    await mkdir(overlayDir(), { recursive: true });
    await appendFile(historyPath(), `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (err) {
    // 이력은 남기지 못해도 승격 자체는 이미 끝났다. 조용히 삼키면
    // 되돌릴 근거가 사라진 걸 아무도 모르므로 경고는 반드시 남긴다.
    console.error(
      `[crawl/registry] 이력 기록 실패 (${historyPath()}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 검증을 통과한 후보를 primary 로 승격한다.
 *
 * **호출자는 반드시 계약 검증을 먼저 통과시켜야 한다.** 이 함수는 검증하지 않는다 —
 * 검증 없이 부를 수 있으면 레지스트리가 오염되기 때문에, 이 계약을 깨는 경로를
 * 만들지 않는 것이 호출자의 책임이다 (`heal.ts` 가 유일한 정상 호출자).
 */
export async function promote(
  selectorId: string,
  selector: string,
  options: { stage: HealStage; singleSample: boolean; reason: string; now?: string },
): Promise<SelectorEntry> {
  const registry = await loadRegistry();
  const current = registry.selectors[selectorId];
  if (!current) {
    throw new RegistryError(`등록되지 않은 셀렉터 id 입니다: ${selectorId}`, 'unknown_selector');
  }

  const at = options.now ?? new Date().toISOString();
  const healed: SelectorEntry = {
    ...current,
    primary: selector,
    // 이전 primary 는 fallback 맨 앞으로 보존한다. 사이트가 되돌아가는 일이 잦다
    fallbacks: [current.primary, ...current.fallbacks.filter((f) => f !== current.primary)].filter(
      (f) => f !== selector,
    ),
    healedAt: at,
    healedFrom: current.primary,
  };

  const overlay = await readOverlay();
  const nextOverlay: Record<string, SelectorEntry> = {};
  for (const [id, entry] of Object.entries(overlay)) {
    if (entry) nextOverlay[id] = entry;
  }
  nextOverlay[selectorId] = healed;

  await writeOverlay(nextOverlay);
  await appendHistory({
    at,
    selectorId,
    stage: options.stage,
    from: current.primary,
    to: selector,
    singleSample: options.singleSample,
    reason: options.reason,
    previous: {
      primary: current.primary,
      fallbacks: [...current.fallbacks],
      healedAt: current.healedAt,
      healedFrom: current.healedFrom,
    },
  });

  registry.selectors[selectorId] = healed;
  return healed;
}

/** 이력 전체 (오래된 순). 파일이 없으면 빈 배열. */
export async function readHistory(): Promise<HistoryRecord[]> {
  let text: string;
  try {
    text = await readFile(historyPath(), 'utf-8');
  } catch {
    return [];
  }
  const out: HistoryRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as HistoryRecord);
    } catch {
      // 깨진 줄 하나 때문에 전체 이력을 못 읽으면 안 된다
      console.warn(
        `[crawl/registry] 이력 한 줄을 해석하지 못했습니다: ${trimmed.slice(0, HISTORY_PREVIEW_CHARS)}`,
      );
    }
  }
  return out;
}

/**
 * 아직 되돌려지지 않은 가장 최근 변경을 찾는다.
 *
 * 뒤에서부터 훑으면서 `revert` 기록을 만나면 그 셀렉터의 "취소 대기" 를 하나 늘리고,
 * 일반 기록을 만났을 때 대기가 있으면 하나 소진하고 지나간다.
 *
 * 이 계산이 없으면 되돌리기를 두 번 눌렀을 때 **직전 되돌리기 기록을 치유로 오인해
 * 원래 값을 다시 되살려 버린다** (되돌리기가 아니라 되살리기가 된다).
 *
 * 파일을 건드리지 않는 순수 함수라 export 한다 — 이 판정이 테스트 대상이다.
 */
export function findRevertTarget(
  history: HistoryRecord[],
  selectorId?: string,
): HistoryRecord | null {
  const pendingUndo = new Map<string, number>();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const rec = history[i];
    if (!rec) continue;
    if (selectorId && rec.selectorId !== selectorId) continue;

    if (rec.stage === 'revert') {
      pendingUndo.set(rec.selectorId, (pendingUndo.get(rec.selectorId) ?? 0) + 1);
      continue;
    }
    const pending = pendingUndo.get(rec.selectorId) ?? 0;
    if (pending > 0) {
      pendingUndo.set(rec.selectorId, pending - 1);
      continue;
    }
    return rec;
  }
  return null;
}

/**
 * 아직 되돌려지지 않은 가장 최근 변경을 한 건 되돌린다.
 *
 * @param selectorId 지정하면 그 셀렉터의 변경만 대상으로 한다
 */
export async function revertLast(selectorId?: string): Promise<HistoryRecord> {
  const history = await readHistory();
  const target = findRevertTarget(history, selectorId);
  if (!target) {
    throw new RegistryError(
      selectorId
        ? `${selectorId} 에 되돌릴 변경이 없습니다.`
        : '되돌릴 변경이 없습니다.',
      'no_history',
    );
  }

  const registry = await loadRegistry();
  const current = registry.selectors[target.selectorId];
  if (!current) {
    throw new RegistryError(
      `이력에는 있으나 레지스트리에 없는 셀렉터입니다: ${target.selectorId}`,
      'unknown_selector',
    );
  }

  // 스냅샷이 있으면 통째로 복원한다. 없는 옛 기록은 primary 만 근사 복원하고,
  // 승격 때 앞으로 밀어 넣었던 옛 primary 만 fallbacks 에서 걷어낸다.
  const restored: SelectorEntry = target.previous
    ? {
        ...current,
        primary: target.previous.primary,
        fallbacks: [...target.previous.fallbacks],
        healedAt: target.previous.healedAt,
        healedFrom: target.previous.healedFrom,
      }
    : {
        ...current,
        primary: target.from,
        fallbacks: current.fallbacks.filter((f) => f !== target.from),
        healedAt: null,
        healedFrom: null,
      };

  const overlay = await readOverlay();
  const nextOverlay: Record<string, SelectorEntry> = {};
  for (const [id, entry] of Object.entries(overlay)) {
    if (entry) nextOverlay[id] = entry;
  }
  nextOverlay[target.selectorId] = restored;
  await writeOverlay(nextOverlay);

  await appendHistory({
    at: new Date().toISOString(),
    selectorId: target.selectorId,
    stage: 'revert',
    from: target.to,
    to: restored.primary,
    singleSample: false,
    reason: `되돌리기 (${target.at} 의 ${target.stage} 취소)`,
    previous: {
      primary: current.primary,
      fallbacks: [...current.fallbacks],
      healedAt: current.healedAt,
      healedFrom: current.healedFrom,
    },
  });

  registry.selectors[target.selectorId] = restored;
  return target;
}
