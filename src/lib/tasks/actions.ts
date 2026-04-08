/**
 * 작업(tasks) Server Actions
 *
 * 출처: src/lib/tasks/queries.ts (D-3a)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 작업 상태를 빠르게 전환하는 액션 (목록의 인라인 버튼용)
 * - 성공 시 revalidatePath로 캐시 무효화
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - taskId는 폼 hidden field, companyId는 세션에서 추출
 */
'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanyContext } from '@/lib/auth/session';

import { TASK_STATUSES, updateTaskStatus, type TaskStatus } from './queries';

// ─────────────────────────────────────────────────────────
// 폼 파싱 헬퍼
// ─────────────────────────────────────────────────────────

function getStringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────
// 액션 — 상태 변경
// ─────────────────────────────────────────────────────────

/**
 * 작업 상태 변경 (목록의 인라인 버튼용 — 단일 인자 형태).
 * 실패해도 throw해서 Next.js 에러 바운더리로 흘려보냄 (P-2: 은폐 금지).
 * 성공 시 revalidatePath로 목록 자동 갱신.
 */
export async function updateTaskStatusAction(form: FormData): Promise<void> {
  const taskId = getStringField(form, 'taskId').trim();
  const nextStatus = getStringField(form, 'status').trim();

  if (!taskId) {
    throw new Error('작업 ID가 없습니다.');
  }
  if (!isTaskStatus(nextStatus)) {
    throw new Error(`유효하지 않은 상태값입니다: ${nextStatus}`);
  }

  const ctx = await requireCompanyContext();

  try {
    await updateTaskStatus({
      companyId: ctx.companyId,
      taskId,
      status: nextStatus,
    });
  } catch (err) {
    console.error('[updateTaskStatusAction] DB 변경 실패:', err);
    throw new Error(
      err instanceof Error
        ? `상태 변경 중 오류가 발생했습니다: ${err.message}`
        : '상태 변경 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/tasks');
  revalidatePath('/importing');
  revalidatePath('/products');
  revalidatePath('/');
}
