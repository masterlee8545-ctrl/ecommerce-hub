/**
 * 수집 리포트 — 여러 소스를 묶되, 실패를 감추지 않는다.
 *
 * 출처: market-research-toolkit `research.py` + `report/schema.py` 의 보고서 규약 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-3 (신뢰도 마킹)
 *
 * ── 이게 푸는 문제 ───────────────────────────────────────
 * 지금 코드에는 "호출은 성공했는데 0건"과 "정상적으로 아무것도 없음"을 구분하지
 * 못하는 자리가 여럿이다. 빈 배열을 돌려주고 `ok: true` 로 응답하면, 사이트
 * 구조가 바뀌어 수집이 완전히 죽어도 화면에는 "데이터 없음"으로만 보인다.
 *
 * 리포트는 소스별로 `status` 를 나눠 그 차이를 드러낸다:
 *   ok      실제로 건졌다
 *   empty   호출은 됐는데 0건 — **성공이 아니다.** 확인이 필요하다
 *   error   호출 자체가 실패
 *   skipped 자격증명이 없어 시도조차 안 함
 *
 * 그리고 `gaps` 에 그 사실을 사람 말로 적는다. UI 는 이걸 그대로 ❓ 로 띄우면 된다.
 */

import { isCrawlError } from './errors';

import type { CrawlReport, SourceOutcome, SourceStatus } from './types';

/** 소스 하나를 수집하는 작업. */
export interface SourceTask<T> {
  /** 리포트에 남길 이름 (`sellochomes`, `itemscout`, `naver_blog` …) */
  name: string;
  /** 이 소스가 의존하는 레지스트리 셀렉터 id 들 — 깨졌을 때 어디를 볼지 가리킨다 */
  selectorIds?: string[];
  /**
   * 실제 수집. 실패하면 던져라 — 빈 배열로 감추지 마라.
   * `null` 을 돌려주면 "자격증명이 없어 건너뜀"(skipped)으로 기록한다.
   */
  run: () => Promise<T[] | null>;
}

/** 빈 결과가 정상일 수 있는 소스를 표시할 때. */
export interface RunOptions {
  /**
   * 0건이 정상인 소스 이름들. 여기 적힌 소스는 0건이어도 `ok` 로 기록한다.
   * **기본은 비어 있다** — 0건을 성공으로 보는 건 예외여야지 기본이면 안 된다.
   */
  emptyIsOk?: string[];
}

function describeError(err: unknown): string {
  if (isCrawlError(err)) {
    const status = err.status === undefined ? '' : ` (HTTP ${err.status})`;
    return `${err.code}${status}${err.reason ? ` — ${err.reason}` : ''}`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function gapMessage(name: string, outcome: SourceOutcome): string | null {
  if (outcome.status === 'ok') return null;
  const where =
    outcome.selectorIds.length > 0 ? ` (관련 셀렉터: ${outcome.selectorIds.join(', ')})` : '';
  if (outcome.status === 'empty') {
    return `${name}: 호출은 됐지만 0건입니다. 사이트 구조가 바뀌었을 수 있어 확인이 필요합니다${where}.`;
  }
  if (outcome.status === 'skipped') {
    return `${name}: 연결 정보가 없어 수집하지 않았습니다${where}.`;
  }
  return `${name}: 수집 실패 — ${outcome.error ?? '사유 미상'}${where}.`;
}

/**
 * 여러 소스를 나란히 수집해 하나의 리포트로 묶는다.
 *
 * 한 소스가 실패해도 나머지는 계속 간다. 대신 실패가 리포트에 그대로 남는다.
 */
export async function runCrawlSources<T>(
  subject: string,
  tasks: Array<SourceTask<T>>,
  options?: RunOptions,
): Promise<CrawlReport<T>> {
  const emptyIsOk = new Set(options?.emptyIsOk ?? []);

  const settled = await Promise.all(
    tasks.map(async (task) => {
      const startedAt = Date.now();
      const selectorIds = task.selectorIds ?? [];
      try {
        const items = await task.run();
        const elapsedMs = Date.now() - startedAt;
        if (items === null) {
          const outcome: SourceOutcome = {
            status: 'skipped',
            count: 0,
            error: null,
            elapsedMs,
            selectorIds,
          };
          return { task, items: [] as T[], outcome };
        }
        const status: SourceStatus =
          items.length > 0 || emptyIsOk.has(task.name) ? 'ok' : 'empty';
        const outcome: SourceOutcome = {
          status,
          count: items.length,
          error: null,
          elapsedMs,
          selectorIds,
        };
        return { task, items, outcome };
      } catch (err) {
        const outcome: SourceOutcome = {
          status: 'error',
          count: 0,
          error: describeError(err),
          elapsedMs: Date.now() - startedAt,
          selectorIds,
        };
        return { task, items: [] as T[], outcome };
      }
    }),
  );

  const sources: Record<string, SourceOutcome> = {};
  const bySource: Record<string, number> = {};
  const items: T[] = [];
  const gaps: string[] = [];
  let okSources = 0;
  let failedSources = 0;

  for (const { task, items: got, outcome } of settled) {
    sources[task.name] = outcome;
    bySource[task.name] = outcome.count;
    items.push(...got);
    if (outcome.status === 'ok') okSources += 1;
    else failedSources += 1;
    const gap = gapMessage(task.name, outcome);
    if (gap) gaps.push(gap);
  }

  return {
    subject,
    generatedAt: new Date().toISOString(),
    summary: {
      totalItems: items.length,
      bySource,
      okSources,
      failedSources,
    },
    sources,
    items,
    gaps,
  };
}

/**
 * 리포트가 "쓸 만한가". 한 소스도 성공하지 못했으면 false.
 *
 * 호출부가 `report.items.length > 0` 만 보고 판단하지 않도록 명시적으로 둔다 —
 * 0건이 성공인지 실패인지는 `sources` 를 봐야 알 수 있다.
 */
export function isUsableReport<T>(report: CrawlReport<T>): boolean {
  return report.summary.okSources > 0;
}

/** 사람이 읽을 한 줄 요약. 로그에 그대로 찍는다. */
export function summarizeReport<T>(report: CrawlReport<T>): string {
  const parts = Object.entries(report.sources).map(
    ([name, outcome]) => `${name}=${outcome.status}(${outcome.count})`,
  );
  return `${report.subject}: 총 ${report.summary.totalItems}건 · ${parts.join(' ')}`;
}
