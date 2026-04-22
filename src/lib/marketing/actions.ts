/**
 * marketing_activities Server Actions (Step 7)
 *
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-4 (멀티테넌트)
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { MARKETING_CHANNELS, MARKETING_STATUSES, type MarketingChannel, type MarketingStatus } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';

import { createActivity, updateActivityStatus } from './activities';

function getStringField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

function getOptionalString(form: FormData, name: string): string | null {
  const t = getStringField(form, name).trim();
  return t.length > 0 ? t : null;
}

/**
 * 새 마케팅 활동 생성.
 * 폼 필드: productId, channel, assigneeId?, costKrw?, resultSummary?, resultUrl?, notes?
 */
export async function createActivityAction(form: FormData): Promise<void> {
  const productId = getStringField(form, 'productId').trim();
  if (!productId) throw new Error('상품 ID가 없습니다.');

  const channelRaw = getStringField(form, 'channel').trim();
  if (!(MARKETING_CHANNELS as readonly string[]).includes(channelRaw)) {
    throw new Error('유효하지 않은 채널입니다.');
  }
  const channel = channelRaw as MarketingChannel;

  const assigneeId = getOptionalString(form, 'assigneeId');
  const costRaw = getStringField(form, 'costKrw').trim();
  const costKrw = costRaw.length > 0 && Number.isFinite(Number(costRaw)) ? Number(costRaw) : null;
  const resultSummary = getOptionalString(form, 'resultSummary');
  const resultUrl = getOptionalString(form, 'resultUrl');
  const notes = getOptionalString(form, 'notes');

  const ctx = await requireCompanyContext();

  await createActivity({
    companyId: ctx.companyId,
    productId,
    userId: ctx.userId,
    channel,
    assigneeId,
    costKrw,
    resultSummary,
    resultUrl,
    notes,
  });

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?flash=activity-added#marketing-panel`);
}

/**
 * 마케팅 활동 상태 전환 (pending → in_progress → done).
 * 폼 필드: activityId, productId, nextStatus
 */
export async function updateActivityStatusAction(form: FormData): Promise<void> {
  const activityId = getStringField(form, 'activityId').trim();
  const productId = getStringField(form, 'productId').trim();
  const statusRaw = getStringField(form, 'nextStatus').trim();

  if (!activityId) throw new Error('활동 ID가 없습니다.');
  if (!(MARKETING_STATUSES as readonly string[]).includes(statusRaw)) {
    throw new Error('유효하지 않은 상태입니다.');
  }
  const status = statusRaw as MarketingStatus;

  const ctx = await requireCompanyContext();
  await updateActivityStatus(ctx.companyId, activityId, status);

  if (productId) {
    revalidatePath(`/products/${productId}`);
    redirect(`/products/${productId}?flash=activity-updated#marketing-panel`);
  }
}
