/**
 * product_plans — 상세페이지 기획서 queries + mutations (Step 4)
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-3 (AI 결과 estimated 마킹)
 *
 * 사용처:
 * - /products/[id]/plan 페이지
 * - 기획서 담당자가 AI 초안을 받아 보강·수정
 * - 상세페이지 작성자에게 인계 (상품 detail 에서 링크)
 *
 * 1 상품 : 1 기획서 — upsertPlan 로 생성/수정 일원화.
 */
import { and, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { productPlans, type ProductPlan, type NewProductPlan } from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 타입 — 섹션
// ─────────────────────────────────────────────────────────

/**
 * 기획서 섹션 하나.
 *
 * 예:
 * {
 *   position: 0,
 *   title: "메인 후킹 — 첫 화면",
 *   imageDesc: "주방 선반 위 제품 클로즈업. 자연광.",
 *   color: "따뜻한 베이지 톤",
 *   copy: "마늘 다지는 데 더 이상 손 아프지 마세요",
 *   hook: "3초 원터치 / 손에 냄새 안 남음",
 * }
 */
export interface PlanSection {
  position: number;
  title: string;
  imageDesc: string | null;
  color: string | null;
  copy: string | null;
  hook: string | null;
}

export interface PlanData {
  sections: PlanSection[];
  hookSummary: string | null;
  targetAudience: string | null;
  notes: string | null;
  resultConfidence: 'estimated' | 'edited' | 'confirmed';
  aiPromptUsed: string | null;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────

/**
 * 상품의 기획서 조회. 없으면 null.
 */
export async function getPlanByProductId(
  companyId: string,
  productId: string,
): Promise<ProductPlan | null> {
  if (!companyId || !productId) {
    throw new Error('[plans] companyId · productId 필수');
  }

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(productPlans)
      .where(
        and(
          eq(productPlans.product_id, productId),
          eq(productPlans.company_id, companyId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

// ─────────────────────────────────────────────────────────
// 생성/수정 (upsert)
// ─────────────────────────────────────────────────────────

export interface UpsertPlanInput {
  companyId: string;
  productId: string;
  userId: string;
  sections?: PlanSection[];
  hookSummary?: string | null;
  targetAudience?: string | null;
  notes?: string | null;
  /** AI 초안 사용 시 프롬프트 — 재현용 */
  aiPromptUsed?: string | null;
  /** 사용자 수정이면 'edited', 확정이면 'confirmed', AI 초안이면 'estimated' */
  resultConfidence?: 'estimated' | 'edited' | 'confirmed';
}

/**
 * 상품 기획서 upsert. 존재하면 UPDATE, 없으면 INSERT.
 */
export async function upsertPlan(input: UpsertPlanInput): Promise<{ id: string }> {
  if (!input.companyId || !input.productId || !input.userId) {
    throw new Error('[upsertPlan] companyId · productId · userId 필수');
  }

  return withCompanyContext(input.companyId, async (tx) => {
    const existing = await tx
      .select({ id: productPlans.id })
      .from(productPlans)
      .where(eq(productPlans.product_id, input.productId))
      .limit(1);

    if (existing[0]) {
      // UPDATE
      const patch: Partial<NewProductPlan> = {
        updated_at: new Date(),
        updated_by: input.userId,
      };
      if (input.sections !== undefined) patch.sections = input.sections;
      if (input.hookSummary !== undefined) patch.hook_summary = input.hookSummary;
      if (input.targetAudience !== undefined) patch.target_audience = input.targetAudience;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.aiPromptUsed !== undefined) patch.ai_prompt_used = input.aiPromptUsed;
      if (input.resultConfidence !== undefined) patch.result_confidence = input.resultConfidence;

      await tx
        .update(productPlans)
        .set(patch)
        .where(eq(productPlans.id, existing[0].id));
      return { id: existing[0].id };
    }

    // INSERT
    const inserted = await tx
      .insert(productPlans)
      .values({
        company_id: input.companyId,
        product_id: input.productId,
        sections: input.sections ?? [],
        hook_summary: input.hookSummary ?? null,
        target_audience: input.targetAudience ?? null,
        notes: input.notes ?? null,
        ai_prompt_used: input.aiPromptUsed ?? null,
        result_confidence: input.resultConfidence ?? 'estimated',
        created_by: input.userId,
        updated_by: input.userId,
      })
      .returning({ id: productPlans.id });

    const row = inserted[0];
    if (!row) throw new Error('[upsertPlan] INSERT가 행을 반환하지 않았습니다.');
    return { id: row.id };
  });
}
