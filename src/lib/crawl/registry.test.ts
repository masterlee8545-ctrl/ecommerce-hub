/**
 * 레지스트리 무결성 테스트.
 *
 * 여기서 도는 검사는 "셀렉터가 지금 사이트에 맞는가"가 아니라
 * "레지스트리 파일 자체가 말이 되는가"다. 계약이 조용히 비어 버리거나
 * 존재하지 않는 컨테이너를 가리키면 자동 치유의 근거가 무너진다.
 */
import fs from 'node:fs';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  findRevertTarget,
  getEntry,
  historyPath,
  loadRegistry,
  overlayPath,
  RegistryError,
  selectorIds,
} from './registry';

import type { CssContract, HistoryRecord, JsonContract } from './types';

describe('레지스트리 파일', () => {
  it('전부 스키마를 통과한다', async () => {
    const registry = await loadRegistry();
    expect(registry.version).toBeGreaterThan(0);
    expect(Object.keys(registry.selectors).length).toBeGreaterThan(0);
  });

  it('JSON 항목의 계약이 깎이지 않는다', async () => {
    // 회귀 방지: 예전에는 계약 스키마를 느슨한 union 으로 뒀더니 JSON 계약이
    // CSS 스키마에 먼저 매치돼 status·jsonKeys 가 전부 사라졌다.
    // 그러면 응답 계약이 빈 계약이 되어 아무것도 검증하지 못한다.
    const registry = await loadRegistry();
    const jsonEntries = Object.entries(registry.selectors).filter(
      ([, entry]) => entry.kind === 'json',
    );
    expect(jsonEntries.length).toBeGreaterThan(0);

    for (const [id, entry] of jsonEntries) {
      const contract = entry.contract as JsonContract;
      const hasSomething =
        contract.status !== undefined || (contract.jsonKeys?.length ?? 0) > 0;
      expect(hasSomething, `${id} 의 계약이 비어 있습니다`).toBe(true);
    }
  });

  it('CSS 항목에는 JSON 계약 키가 섞여 있지 않다', async () => {
    const registry = await loadRegistry();
    for (const [id, entry] of Object.entries(registry.selectors)) {
      if (entry.kind !== 'css') continue;
      const contract = entry.contract as Record<string, unknown>;
      expect(contract['jsonKeys'], `${id}`).toBeUndefined();
      expect(contract['status'], `${id}`).toBeUndefined();
    }
  });

  it('within 이 가리키는 컨테이너가 실제로 있고 css 항목이다', async () => {
    const registry = await loadRegistry();
    for (const [id, entry] of Object.entries(registry.selectors)) {
      if (!entry.within) continue;
      const container = registry.selectors[entry.within];
      expect(container, `${id} 의 within(${entry.within}) 이 레지스트리에 없습니다`).toBeDefined();
      expect(container?.kind, `${id} 의 within 은 css 여야 합니다`).toBe('css');
      // 컨테이너가 또 다른 컨테이너 안쪽이면 범위 해석이 한 단계로 끝나지 않는다
      expect(container?.within, `${id} 의 within 은 중첩되면 안 됩니다`).toBeNull();
    }
  });

  it('css 항목의 계약은 최소 하나의 판정 근거를 갖는다', async () => {
    const registry = await loadRegistry();
    for (const [id, entry] of Object.entries(registry.selectors)) {
      if (entry.kind !== 'css') continue;
      const contract = entry.contract as CssContract;
      const hasSomething =
        contract.minMatches !== undefined ||
        contract.attr !== undefined ||
        contract.mustMatch !== undefined ||
        contract.minTextLen !== undefined;
      expect(hasSomething, `${id} 의 계약이 비어 있습니다`).toBe(true);
    }
  });

  it('셀렉터 id 는 <소스>.<역할> 형태다', async () => {
    for (const id of await selectorIds()) {
      expect(id, `${id}`).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });
});

describe('덮개 경로', () => {
  it('모듈 로드 시점이 아니라 부를 때마다 cwd 로 계산한다', () => {
    // 회귀 방지: 경로를 모듈 상수로 굳혀 두면, cwd 를 옮긴 뒤에도 옛 경로에 쓴다.
    // 실제로 연기 점검이 저장소를 건드리지 않으려고 임시 폴더로 옮겼는데,
    // 경로가 굳어 있어 **저장소의 레지스트리를 가짜 셀렉터로 덮어썼다.**
    const original = process.cwd();
    const before = overlayPath();
    try {
      process.chdir(os.tmpdir());
      const after = overlayPath();
      expect(after).not.toBe(before);
      expect(after.startsWith(fs.realpathSync(os.tmpdir()))
        || after.startsWith(os.tmpdir())).toBe(true);
      expect(historyPath()).toContain('crawl-registry');
    } finally {
      process.chdir(original);
    }
    expect(overlayPath()).toBe(before);
  });
});

describe('findRevertTarget', () => {
  /** 이력 한 줄을 짧게 만든다. */
  function rec(
    at: string,
    stage: HistoryRecord['stage'],
    from: string,
    to: string,
    selectorId = 'sello.row',
  ): HistoryRecord {
    return { at, selectorId, stage, from, to, singleSample: false, reason: 't' };
  }

  it('이력이 없으면 null', () => {
    expect(findRevertTarget([])).toBeNull();
  });

  it('가장 최근 치유를 고른다', () => {
    const history = [rec('1', 'fallback', 'A', 'B'), rec('2', 'heuristic', 'B', 'C')];
    expect(findRevertTarget(history)?.at).toBe('2');
  });

  it('되돌리기를 두 번 하면 한 단계씩 더 거슬러 올라간다 — 되살리지 않는다', () => {
    // 회귀 방지: 예전에는 되돌리기 기록을 '치유'로 오인해, 두 번째 되돌리기가
    // 방금 취소한 치유를 그대로 재적용했다 (되돌리기가 아니라 되살리기).
    const history: HistoryRecord[] = [
      rec('1', 'fallback', 'A', 'B'),
      rec('2', 'heuristic', 'B', 'C'),
    ];

    const first = findRevertTarget(history);
    expect(first?.at).toBe('2');
    history.push(rec('3', 'revert', 'C', 'B'));

    const second = findRevertTarget(history);
    expect(second?.at).toBe('1'); // C 로 되살아나면 안 된다
    history.push(rec('4', 'revert', 'B', 'A'));

    expect(findRevertTarget(history)).toBeNull(); // 더 되돌릴 게 없다
  });

  it('셀렉터를 지정하면 그 셀렉터의 변경만 본다', () => {
    const history = [
      rec('1', 'fallback', 'A', 'B', 'sello.row'),
      rec('2', 'fallback', 'X', 'Y', 'sello.row_name'),
    ];
    expect(findRevertTarget(history, 'sello.row')?.at).toBe('1');
    expect(findRevertTarget(history, 'sello.row_name')?.at).toBe('2');
  });

  it('셀렉터별로 되돌리기 대기를 따로 센다', () => {
    const history: HistoryRecord[] = [
      rec('1', 'fallback', 'A', 'B', 'sello.row'),
      rec('2', 'fallback', 'X', 'Y', 'sello.row_name'),
      rec('3', 'revert', 'Y', 'X', 'sello.row_name'),
    ];
    // row_name 은 이미 되돌려졌으므로 남은 대상은 row 의 기록이어야 한다
    expect(findRevertTarget(history)?.selectorId).toBe('sello.row');
    expect(findRevertTarget(history, 'sello.row_name')).toBeNull();
  });
});

describe('getEntry', () => {
  it('등록된 id 를 돌려준다', async () => {
    const entry = await getEntry('sello.row');
    expect(entry.kind).toBe('css');
    expect(entry.primary.length).toBeGreaterThan(0);
  });

  it('모르는 id 는 조용히 넘기지 않고 던진다', async () => {
    await expect(getEntry('sello.does_not_exist')).rejects.toBeInstanceOf(RegistryError);
  });
});
