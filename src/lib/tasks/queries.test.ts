/**
 * 작업 쿼리 헬퍼 단위 테스트
 *
 * 출처: src/lib/tasks/queries.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-1 (빈 결과 명시)
 *
 * 검증 항목:
 * 1. parseTaskStatusFilter — URL 파라미터 파싱 (유효 / 잘못된 값 / 빈 값)
 * 2. TASK_STATUSES / OPEN_TASK_STATUSES 상수 무결성
 * 3. updateTaskStatus — 입력 검증 (companyId/taskId 누락 → throw)
 *
 * 주의: 실제 DB를 호출하지 않는다 (DB 의존 함수는 입력 검증만 검사).
 */
import { describe, expect, it } from 'vitest';

import {
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  listTasksForProducts,
  parseTaskStatusFilter,
  updateTaskStatus,
} from './queries';

// ─────────────────────────────────────────────────────────
// 1. parseTaskStatusFilter — URL 파싱
// ─────────────────────────────────────────────────────────

describe('parseTaskStatusFilter — URL 파라미터 파싱', () => {
  it('null 입력 시 빈 배열', () => {
    expect(parseTaskStatusFilter(null)).toEqual([]);
  });

  it('undefined 입력 시 빈 배열', () => {
    expect(parseTaskStatusFilter(undefined)).toEqual([]);
  });

  it('빈 문자열 시 빈 배열', () => {
    expect(parseTaskStatusFilter('')).toEqual([]);
  });

  it('단일 유효 상태 파싱', () => {
    expect(parseTaskStatusFilter('pending')).toEqual(['pending']);
  });

  it('쉼표 구분 다중 상태 파싱', () => {
    const result = parseTaskStatusFilter('pending,in_progress,review');
    expect(result).toEqual(['pending', 'in_progress', 'review']);
  });

  it('잘못된 값은 조용히 무시', () => {
    const result = parseTaskStatusFilter('pending,invalid_status,done');
    expect(result).toEqual(['pending', 'done']);
  });

  it('전부 잘못된 값이면 빈 배열', () => {
    const result = parseTaskStatusFilter('foo,bar,baz');
    expect(result).toEqual([]);
  });

  it('공백 트리밍', () => {
    const result = parseTaskStatusFilter(' pending , done ');
    expect(result).toEqual(['pending', 'done']);
  });
});

// ─────────────────────────────────────────────────────────
// 2. 상수 무결성
// ─────────────────────────────────────────────────────────

describe('TASK_STATUSES / OPEN_TASK_STATUSES — 상수 무결성', () => {
  it('TASK_STATUSES는 5종', () => {
    const EXPECTED_COUNT = 5;
    expect(TASK_STATUSES).toHaveLength(EXPECTED_COUNT);
  });

  it('TASK_STATUSES에 모든 핵심 상태 포함', () => {
    expect(TASK_STATUSES).toContain('pending');
    expect(TASK_STATUSES).toContain('in_progress');
    expect(TASK_STATUSES).toContain('review');
    expect(TASK_STATUSES).toContain('done');
    expect(TASK_STATUSES).toContain('cancelled');
  });

  it('OPEN_TASK_STATUSES는 done/cancelled 제외', () => {
    expect(OPEN_TASK_STATUSES).toContain('pending');
    expect(OPEN_TASK_STATUSES).toContain('in_progress');
    expect(OPEN_TASK_STATUSES).toContain('review');
    expect(OPEN_TASK_STATUSES).not.toContain('done');
    expect(OPEN_TASK_STATUSES).not.toContain('cancelled');
  });
});

// ─────────────────────────────────────────────────────────
// 3. updateTaskStatus — 입력 검증
// ─────────────────────────────────────────────────────────

describe('updateTaskStatus — 입력 검증 (DB 호출 전 단계)', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      updateTaskStatus({
        companyId: '',
        taskId: 'some-task-id',
        status: 'in_progress',
      }),
    ).rejects.toThrow('companyId');
  });

  it('taskId 누락 시 throw', async () => {
    await expect(
      updateTaskStatus({
        companyId: 'some-company-id',
        taskId: '',
        status: 'in_progress',
      }),
    ).rejects.toThrow('taskId');
  });

  it('잘못된 status 시 throw', async () => {
    await expect(
      updateTaskStatus({
        companyId: 'some-company-id',
        taskId: 'some-task-id',
        // @ts-expect-error - 의도적인 잘못된 값
        status: 'flying',
      }),
    ).rejects.toThrow('유효하지 않은 상태');
  });
});

// ─────────────────────────────────────────────────────────
// 4. listTasksForProducts — 대시보드 헬퍼 (G-1)
// ─────────────────────────────────────────────────────────

describe('listTasksForProducts — 입력 검증 및 단락 평가', () => {
  it('companyId 누락 시 throw', async () => {
    await expect(
      listTasksForProducts({
        companyId: '',
        productIds: ['some-id'],
      }),
    ).rejects.toThrow('companyId');
  });

  it('productIds가 빈 배열이면 DB 호출 없이 즉시 [] 반환', async () => {
    // 이 테스트는 withCompanyContext 전에 short-circuit 되는지 확인한다.
    // 빈 배열 + 가짜 companyId로도 throw가 나지 않고 [] 반환됨.
    const result = await listTasksForProducts({
      companyId: 'non-existent-company-id',
      productIds: [],
    });
    expect(result).toEqual([]);
  });

  it('productIds가 빈 배열이면 openOnly 옵션과 무관하게 [] 반환', async () => {
    const result = await listTasksForProducts({
      companyId: 'non-existent-company-id',
      productIds: [],
      openOnly: true,
    });
    expect(result).toEqual([]);
  });
});
