/**
 * marketing_activities — queries + mutations (Step 7)
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-1 (빈 결과 명시)
 */
import { and, desc, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import {
  marketingActivities,
  type MarketingActivity,
  type MarketingChannel,
  type MarketingStatus,
  type NewMarketingActivity,
} from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────

/** 특정 상품의 모든 마케팅 활동 (최신순) */
export async function listActivitiesForProduct(
  companyId: string,
  productId: string,
): Promise<MarketingActivity[]> {
  if (!companyId || !productId) return [];
  return withCompanyContext(companyId, async (tx) => {
    return tx
      .select()
      .from(marketingActivities)
      .where(
        and(
          eq(marketingActivities.product_id, productId),
          eq(marketingActivities.company_id, companyId),
        ),
      )
      .orderBy(desc(marketingActivities.created_at));
  });
}

// ─────────────────────────────────────────────────────────
// 생성
// ─────────────────────────────────────────────────────────

export interface CreateActivityInput {
  companyId: string;
  productId: string;
  userId: string;
  channel: MarketingChannel;
  status?: MarketingStatus;
  assigneeId?: string | null;
  costKrw?: number | null;
  resultSummary?: string | null;
  resultUrl?: string | null;
  notes?: string | null;
}

export async function createActivity(input: CreateActivityInput): Promise<{ id: string }> {
  if (!input.companyId || !input.productId || !input.userId) {
    throw new Error('[createActivity] companyId · productId · userId 필수');
  }
  return withCompanyContext(input.companyId, async (tx) => {
    const values: NewMarketingActivity = {
      company_id: input.companyId,
      product_id: input.productId,
      channel: input.channel,
      status: input.status ?? 'pending',
      assignee_id: input.assigneeId ?? null,
      cost_krw: input.costKrw !== null && input.costKrw !== undefined ? String(input.costKrw) : null,
      result_summary: input.resultSummary ?? null,
      result_url: input.resultUrl ?? null,
      notes: input.notes ?? null,
      created_by: input.userId,
    };
    const inserted = await tx
      .insert(marketingActivities)
      .values(values)
      .returning({ id: marketingActivities.id });
    const row = inserted[0];
    if (!row) throw new Error('[createActivity] INSERT 실패');
    return { id: row.id };
  });
}

// ─────────────────────────────────────────────────────────
// 상태 전환
// ─────────────────────────────────────────────────────────

export async function updateActivityStatus(
  companyId: string,
  activityId: string,
  status: MarketingStatus,
): Promise<void> {
  if (!companyId || !activityId) {
    throw new Error('[updateActivityStatus] companyId · activityId 필수');
  }
  const patch: Partial<NewMarketingActivity> = {
    status,
    updated_at: new Date(),
  };
  // 상태 전환 시 타임스탬프 자동 채움
  if (status === 'in_progress') patch.started_at = new Date();
  if (status === 'done') patch.completed_at = new Date();

  await withCompanyContext(companyId, async (tx) => {
    await tx
      .update(marketingActivities)
      .set(patch)
      .where(
        and(
          eq(marketingActivities.id, activityId),
          eq(marketingActivities.company_id, companyId),
        ),
      );
  });
}
