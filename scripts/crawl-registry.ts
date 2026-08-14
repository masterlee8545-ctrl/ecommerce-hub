#!/usr/bin/env node
/**
 * 셀렉터 레지스트리 관리 CLI (ADR-014).
 *
 * 사용법:
 *   npm run crawl:list                       등록된 셀렉터와 치유 상태 보기
 *   npm run crawl:history                    레지스트리 변경 이력 보기
 *   npm run crawl:revert -- [셀렉터id]        마지막 치유 되돌리기
 *   npm run crawl:adopt -- <셀렉터id> <스냅샷폴더> <응답파일|JSON>
 *                                            Claude 가 준 후보를 스냅샷으로 재검증 후 채택
 *
 * `adopt` 는 받은 답을 그대로 믿지 않는다. `data/crawl-snapshots/<...>/page.html` 로
 * 계약을 다시 돌려, 통과한 후보만 레지스트리에 기록한다.
 *
 * 출력은 process.stdout.write 를 쓴다 — CLI 결과는 표준출력으로 나가야 파이프로
 * 넘길 수 있고, 프로젝트 lint 는 console.log 를 막고 있다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { adoptCandidates } from '../src/lib/crawl/heal.js';
import {
  getEntry,
  historyPath,
  loadRegistry,
  overlayPath,
  readHistory,
  revertLast,
  selectorIds,
} from '../src/lib/crawl/registry.js';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function cmdList(): Promise<void> {
  const registry = await loadRegistry();
  const ids = await selectorIds();
  out(`레지스트리 v${registry.version} — 셀렉터 ${ids.length}건`);
  out(`덮개 파일: ${overlayPath()}`);
  out('');
  for (const id of ids) {
    const entry = registry.selectors[id];
    if (!entry) continue;
    const healed = entry.healedAt ? ` ⟵ 치유됨 ${entry.healedAt} (이전: ${entry.healedFrom})` : '';
    const scope = entry.within ? ` [범위: ${entry.within}]` : '';
    out(`${id}  (${entry.kind})${scope}`);
    out(`  현재:  ${entry.primary}${healed}`);
    if (entry.fallbacks.length > 0) out(`  대안:  ${entry.fallbacks.join(' | ')}`);
    out(`  계약:  ${JSON.stringify(entry.contract)}`);
    out(`  설명:  ${entry.description}`);
    out('');
  }
}

async function cmdHistory(): Promise<void> {
  const history = await readHistory();
  out(`이력 파일: ${historyPath()}`);
  if (history.length === 0) {
    out('아직 기록된 변경이 없습니다.');
    return;
  }
  for (const rec of history) {
    const flag = rec.singleSample ? ' ⚠샘플1건' : '';
    out(`${rec.at}  ${rec.selectorId}  [${rec.stage}]${flag}`);
    out(`  ${rec.from}`);
    out(`  → ${rec.to}`);
    out(`  사유: ${rec.reason}`);
    out('');
  }
}

async function cmdRevert(selectorId?: string): Promise<void> {
  const reverted = await revertLast(selectorId);
  out(`되돌렸습니다: ${reverted.selectorId}`);
  out(`  ${reverted.to}  →  ${reverted.from}`);
}

async function cmdAdopt(
  selectorId: string,
  snapshotDir: string,
  candidatesArg: string,
): Promise<void> {
  const entry = await getEntry(selectorId);
  const html = await readFile(path.join(snapshotDir, 'page.html'), 'utf-8');

  // 인자가 파일 경로면 읽고, 아니면 JSON 문자열로 본다
  let rawJson = candidatesArg;
  try {
    rawJson = await readFile(candidatesArg, 'utf-8');
  } catch {
    // 파일이 아니면 인자 자체가 JSON 이다
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `후보 JSON 을 해석할 수 없습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const candidates =
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { candidates?: unknown }).candidates)
      ? ((parsed as { candidates: unknown[] }).candidates.filter(
          (c): c is string => typeof c === 'string',
        ))
      : Array.isArray(parsed)
        ? parsed.filter((c): c is string => typeof c === 'string')
        : [];

  if (candidates.length === 0) {
    throw new Error('후보가 없습니다. { "candidates": ["...", "..."] } 형식이어야 합니다.');
  }

  out(`${selectorId} 후보 ${candidates.length}건을 스냅샷으로 재검증합니다...`);
  const result = await adoptCandidates(html, selectorId, candidates);
  if (!result) {
    out('통과한 후보가 없습니다. 레지스트리는 그대로 둡니다.');
    out(`  계약: ${JSON.stringify(entry.contract)}`);
    process.exitCode = 1;
    return;
  }
  out(`채택: ${result.adopted}  (${result.matches}건 매칭)`);
  out(`덮개 파일에 기록했습니다: ${overlayPath()}`);
  out('확정하려면 이 값을 src/lib/crawl/selectors.json 에 반영해 커밋하세요.');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'list':
      await cmdList();
      return;
    case 'history':
      await cmdHistory();
      return;
    case 'revert':
      await cmdRevert(rest[0]);
      return;
    case 'adopt': {
      const [selectorId, snapshotDir, candidatesArg] = rest;
      if (!selectorId || !snapshotDir || !candidatesArg) {
        throw new Error(
          '사용법: npm run crawl:adopt -- <셀렉터id> <스냅샷폴더> <응답파일|JSON>',
        );
      }
      await cmdAdopt(selectorId, snapshotDir, candidatesArg);
      return;
    }
    default:
      out('명령: list | history | revert [셀렉터id] | adopt <셀렉터id> <스냅샷폴더> <응답파일|JSON>');
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
