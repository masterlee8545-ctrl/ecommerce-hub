/**
 * 상품(products) Server Actions
 *
 * 출처: src/lib/products/mutations.ts, src/lib/products/transitions.ts (E-1a/E-1b)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시 에러), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어), §1 P-3 (estimated 강제)
 *
 * 역할:
 * - 신규 상품 등록 (createProductAction) — useActionState용
 * - 일반 정보 수정 (updateProductAction) — useActionState용
 * - 단계 전환 (transitionProductStatusAction) — fire-and-forget 인라인 버튼용
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - companyId는 폼이 아니라 세션에서 추출 (사용자가 위조 못함)
 *
 * Next.js 15 'use server' 제약:
 * - 이 파일은 async 함수만 export 가능
 * - 상태 타입/초기값은 ./action-types.ts에서 import (export 금지)
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  assertCanEditPlan,
  assertCanTransitionStatus,
  assertManager,
  PermissionError,
} from '@/lib/auth/permissions';
import { requireCompanyContext } from '@/lib/auth/session';

import { type ProductActionState, type ProductFieldKey } from './action-types';
import { CONFIDENCE_LEVELS, PIPELINE_STAGES, type ConfidenceLevel, type PipelineStage } from './constants';
import { createProduct, updateProduct, suggestNextProductCode } from './mutations';
import { upsertPlan, type PlanSection } from './plans';
import { getProductById } from './queries';
import { transitionProductStatus } from './transitions';

// ─────────────────────────────────────────────────────────
// 폼 파싱 헬퍼
// ─────────────────────────────────────────────────────────

function getStringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** 빈 문자열 → null, 아니면 trimmed string */
function getOptionalStringField(form: FormData, name: string): string | null {
  const trimmed = getStringField(form, name).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 숫자 필드 파싱: 빈 값/유효하지 않은 값 → null */
function parseDecimalField(form: FormData, name: string): number | null {
  const raw = getStringField(form, name).trim();
  if (raw.length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 마진율 폼 입력 파싱.
 * 사용자는 '40' (퍼센트) 형태로 입력 → 0.4로 변환.
 */
function parseMarginRateField(form: FormData): number | null {
  const PERCENT_DIVISOR = 100;
  const raw = parseDecimalField(form, 'marginRate');
  if (raw === null) return null;
  return raw / PERCENT_DIVISOR;
}

function parseConfidenceField(form: FormData, name: string): ConfidenceLevel | undefined {
  const raw = getStringField(form, name).trim();
  if (raw.length === 0) return undefined;
  if ((CONFIDENCE_LEVELS as readonly string[]).includes(raw)) {
    return raw as ConfidenceLevel;
  }
  return undefined;
}

function parsePipelineStageField(form: FormData, name: string): PipelineStage | null {
  const raw = getStringField(form, name).trim();
  if ((PIPELINE_STAGES as readonly string[]).includes(raw)) {
    return raw as PipelineStage;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 폼 검증 — 생성 / 수정 공용
// ─────────────────────────────────────────────────────────

interface ParsedProductFormData {
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  cogsCny: number | null;
  cogsCnyConfidence: ConfidenceLevel | undefined;
  sellingPriceKrw: number | null;
  marginRate: number | null;
  marginRateConfidence: ConfidenceLevel | undefined;
}

function validateForm(
  form: FormData,
  mode: 'create' | 'edit',
):
  | { ok: true; data: ParsedProductFormData }
  | { ok: false; state: ProductActionState } {
  const code = getStringField(form, 'code').trim();
  const name = getStringField(form, 'name').trim();
  const category = getOptionalStringField(form, 'category');
  const description = getOptionalStringField(form, 'description');
  const cogsCny = parseDecimalField(form, 'cogsCny');
  const cogsCnyConfidence = parseConfidenceField(form, 'cogsCnyConfidence');
  const sellingPriceKrw = parseDecimalField(form, 'sellingPriceKrw');
  const marginRate = parseMarginRateField(form);
  const marginRateConfidence = parseConfidenceField(form, 'marginRateConfidence');

  const fieldErrors: Partial<Record<ProductFieldKey, string>> = {};

  // code는 생성 시에만 필수 (수정 시에는 변경 불가 — 폼에 없음)
  if (mode === 'create' && code.length === 0) {
    fieldErrors.code = '상품 코드를 입력하세요.';
  }
  if (name.length === 0) {
    fieldErrors.name = '상품 이름을 입력하세요.';
  }
  if (cogsCny !== null && cogsCny < 0) {
    fieldErrors.cogsCny = '원가는 0보다 작을 수 없습니다.';
  }
  if (sellingPriceKrw !== null && sellingPriceKrw < 0) {
    fieldErrors.sellingPriceKrw = '판매가는 0보다 작을 수 없습니다.';
  }
  if (marginRate !== null && (marginRate < -1 || marginRate > 1)) {
    fieldErrors.marginRate = '마진률은 -100% ~ 100% 사이여야 합니다.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { ok: false, error: '입력값을 확인해주세요.', fieldErrors } };
  }

  return {
    ok: true,
    data: {
      code,
      name,
      category,
      description,
      cogsCny,
      cogsCnyConfidence,
      sellingPriceKrw,
      marginRate,
      marginRateConfidence,
    },
  };
}

// ─────────────────────────────────────────────────────────
// 액션 — 신규 등록
// ─────────────────────────────────────────────────────────

export async function createProductAction(
  _prev: ProductActionState,
  form: FormData,
): Promise<ProductActionState> {
  const ctx = await requireCompanyContext();
  try {
    assertManager(ctx.role, '상품 생성');
  } catch (err) {
    if (err instanceof PermissionError) return { ok: false, error: err.message };
    throw err;
  }

  const validated = validateForm(form, 'create');
  if (!validated.ok) return validated.state;

  let createdId: string;
  try {
    const { id } = await createProduct({
      companyId: ctx.companyId,
      code: validated.data.code,
      name: validated.data.name,
      category: validated.data.category,
      description: validated.data.description,
      cogsCny: validated.data.cogsCny,
      cogsCnyConfidence: validated.data.cogsCnyConfidence,
      sellingPriceKrw: validated.data.sellingPriceKrw,
      marginRate: validated.data.marginRate,
      marginRateConfidence: validated.data.marginRateConfidence,
      createdBy: ctx.userId,
      ownerUserId: ctx.userId,
    });
    createdId = id;
  } catch (err) {
    console.error('[createProductAction] DB 저장 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `저장 중 오류가 발생했습니다: ${err.message}`
          : '저장 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  revalidatePath('/products');
  redirect(`/products/${createdId}`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 일반 정보 수정 (status 제외)
// ─────────────────────────────────────────────────────────

export async function updateProductAction(
  productId: string,
  _prev: ProductActionState,
  form: FormData,
): Promise<ProductActionState> {
  if (!productId) {
    return { ok: false, error: '상품 ID가 없습니다.' };
  }

  const ctx = await requireCompanyContext();
  try {
    assertManager(ctx.role, '상품 정보 수정');
  } catch (err) {
    if (err instanceof PermissionError) return { ok: false, error: err.message };
    throw err;
  }

  const validated = validateForm(form, 'edit');
  if (!validated.ok) return validated.state;

  try {
    await updateProduct({
      companyId: ctx.companyId,
      productId,
      name: validated.data.name,
      category: validated.data.category,
      description: validated.data.description,
      cogsCny: validated.data.cogsCny,
      cogsCnyConfidence: validated.data.cogsCnyConfidence,
      sellingPriceKrw: validated.data.sellingPriceKrw,
      marginRate: validated.data.marginRate,
      marginRateConfidence: validated.data.marginRateConfidence,
    });
  } catch (err) {
    console.error('[updateProductAction] DB 수정 실패:', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `수정 중 오류가 발생했습니다: ${err.message}`
          : '수정 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  revalidatePath('/products');
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 단계 전환 (fire-and-forget 인라인 버튼)
// ─────────────────────────────────────────────────────────

/**
 * 상세 페이지의 "다음 단계로 진행" 버튼에서 호출.
 * 폼 hidden input으로 productId, toStatus를 전달한다.
 *
 * 실패 시 throw → Next.js error.tsx가 사용자 친화 메시지로 표시.
 * 성공 시 캐시 무효화 후 같은 페이지로 redirect (서버 컴포넌트 자동 새로고침).
 */
export async function transitionProductStatusAction(form: FormData): Promise<void> {
  const productId = getStringField(form, 'productId').trim();
  const toStatus = parsePipelineStageField(form, 'toStatus');
  const reason = getOptionalStringField(form, 'reason');

  if (!productId) {
    throw new Error('상품 ID가 없습니다.');
  }
  if (!toStatus) {
    throw new Error('전환할 단계가 잘못되었습니다.');
  }

  const ctx = await requireCompanyContext();

  const product = await getProductById(ctx.companyId, productId);
  if (!product) throw new Error('상품을 찾을 수 없습니다.');
  assertCanTransitionStatus(ctx.role, product, ctx.userId);

  try {
    await transitionProductStatus({
      companyId: ctx.companyId,
      productId,
      toStatus,
      changedBy: ctx.userId,
      reason,
    });
  } catch (err) {
    console.error('[transitionProductStatusAction] 단계 전환 실패:', err);
    throw new Error(
      err instanceof Error
        ? `단계 전환 실패: ${err.message}`
        : '단계 전환 중 알 수 없는 오류가 발생했습니다.',
    );
  }

  revalidatePath('/products');
  revalidatePath(`/products/${productId}`);
  revalidatePath('/tasks'); //                          자동 생성된 task가 작업 목록에 반영되도록
  revalidatePath('/'); //                               대시보드 카운터 업데이트
  redirect(`/products/${productId}?flash=transitioned`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 장바구니 빠른 추가 (상품 발굴용)
// ─────────────────────────────────────────────────────────

/**
 * research 페이지 장바구니에서 호출.
 * 이름만으로 빠르게 상품 등록 (코드 자동 생성, status = 'research').
 * sourceUrl, memo는 description에 저장.
 *
 * 법인 선택(Option B):
 * - 폼에 `targetCompanyId` 가 있고 사용자가 그 법인 멤버면 그 법인에 담음
 * - 없거나 맞지 않으면 active company 에 담음 (backward compat)
 */
export async function quickAddToBasketAction(form: FormData): Promise<void> {
  const name = getStringField(form, 'name').trim();
  const sourceUrl = getOptionalStringField(form, 'sourceUrl');
  const cnSourceUrl = getOptionalStringField(form, 'cnSourceUrl');
  const memo = getOptionalStringField(form, 'memo');
  const targetCompanyIdRaw = getOptionalStringField(form, 'targetCompanyId');
  const redirectToRaw = getOptionalStringField(form, 'redirectTo');

  if (name.length === 0) {
    throw new Error('상품 이름을 입력해주세요.');
  }

  const ctx = await requireCompanyContext();

  // 대상 법인 결정 — 멤버십 검증으로 무단 전환 차단 (P-4)
  let targetCompanyId = ctx.companyId;
  if (targetCompanyIdRaw && targetCompanyIdRaw !== ctx.companyId) {
    const isMember = ctx.memberships.some((m) => m.companyId === targetCompanyIdRaw);
    if (!isMember) {
      throw new Error('해당 법인에 접근 권한이 없습니다.');
    }
    targetCompanyId = targetCompanyIdRaw;
  }

  // 코드 자동 생성 (대상 법인 기준)
  let code: string;
  try {
    code = await suggestNextProductCode(targetCompanyId);
  } catch {
    // DB 미준비 시 timestamp 기반 폴백
    code = `PROD-${Date.now()}`;
  }

  // description에 소스URL + 메모 합침
  const descParts: string[] = [];
  if (sourceUrl) descParts.push(`소스: ${sourceUrl}`);
  if (memo) descParts.push(memo);
  const description = descParts.length > 0 ? descParts.join('\n') : null;

  try {
    await createProduct({
      companyId: targetCompanyId,
      code,
      name,
      description,
      cnSourceUrl,
      createdBy: ctx.userId,
      ownerUserId: ctx.userId,
    });
  } catch (err) {
    console.error('[quickAddToBasketAction] 저장 실패:', err);
    throw new Error(
      err instanceof Error
        ? `장바구니 추가 실패: ${err.message}`
        : '장바구니 추가 중 오류가 발생했습니다.',
    );
  }

  revalidatePath('/research');
  revalidatePath('/products');
  revalidatePath('/');

  // 담기 후 자동 이동 (선택) — 내부 경로만 허용 (open redirect 방지)
  if (redirectToRaw && redirectToRaw.startsWith('/')) {
    redirect(redirectToRaw);
  }
}

// ─────────────────────────────────────────────────────────
// 액션 — 배치 장바구니 담기 (Batch Analysis 결과 → 다수 한 번에)
// ─────────────────────────────────────────────────────────

/**
 * 키워드 배열을 받아 한 번에 장바구니에 담는다.
 *
 * 폼 필드:
 * - keywords (반복) — 담을 키워드 이름들
 * - targetCompanyId (선택) — 멤버십 검증 후 해당 법인
 * - memoPrefix (선택) — 각 상품 memo 앞에 붙일 공통 문자 (예: "배치 분석 통과")
 *
 * 멱등성: 같은 법인에 같은 이름으로 이미 있는 상품은 스킵.
 */
export async function bulkAddToBasketAction(form: FormData): Promise<void> {
  const raw = form.getAll('keywords');
  const keywords = raw
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  const targetCompanyIdRaw = getOptionalStringField(form, 'targetCompanyId');
  const memoPrefix = getOptionalStringField(form, 'memoPrefix');

  if (keywords.length === 0) {
    throw new Error('담을 키워드가 없습니다.');
  }

  const ctx = await requireCompanyContext();
  assertManager(ctx.role, '일괄 장바구니 담기');

  let targetCompanyId = ctx.companyId;
  if (targetCompanyIdRaw && targetCompanyIdRaw !== ctx.companyId) {
    const isMember = ctx.memberships.some((m) => m.companyId === targetCompanyIdRaw);
    if (!isMember) throw new Error('해당 법인에 접근 권한이 없습니다.');
    targetCompanyId = targetCompanyIdRaw;
  }

  // 순차 생성 — 코드 suggestion 이 DB 조회하므로 병렬하면 같은 코드 충돌
  const createdCount: { ok: number; skipped: number; failed: number } = {
    ok: 0,
    skipped: 0,
    failed: 0,
  };
  for (const name of keywords) {
    try {
      const RADIX_ALPHANUM = 36;
      const RANDOM_SUFFIX_LEN = 6;
      const code = await suggestNextProductCode(targetCompanyId).catch(
        () =>
          `PROD-${Date.now()}-${Math.random()
            .toString(RADIX_ALPHANUM)
            .slice(2, 2 + RANDOM_SUFFIX_LEN - 2)}`,
      );
      const description = memoPrefix ?? null;
      await createProduct({
        companyId: targetCompanyId,
        code,
        name,
        description,
        createdBy: ctx.userId,
        ownerUserId: ctx.userId,
      });
      createdCount.ok += 1;
    } catch (err) {
      // UNIQUE 충돌 (이미 같은 code) → skip, 그 외는 failed
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        createdCount.skipped += 1;
      } else {
        console.error('[bulkAddToBasketAction] 개별 실패:', err);
        createdCount.failed += 1;
      }
    }
  }

  revalidatePath('/research');
  revalidatePath('/products');
  revalidatePath('/');
  redirect(
    `/research?flash=bulk-added:${createdCount.ok},${createdCount.skipped},${createdCount.failed}`,
  );
}

// ─────────────────────────────────────────────────────────
// 액션 — 가격 정보 저장 (계산기에서 호출)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 액션 — 워크플로우 필드 저장 (Step 3 + 5)
// ─────────────────────────────────────────────────────────

/**
 * 상품의 1688 링크 + 담당자 3명 배정 저장.
 * WorkflowPanel 컴포넌트에서 호출.
 *
 * 폼 필드:
 * - productId
 * - cnSourceUrl (선택, 빈 문자열 → null)
 * - planAssigneeId / listingAssigneeId / rocketAssigneeId (선택, 빈 문자열 → null)
 */
export async function updateWorkflowAction(form: FormData): Promise<void> {
  const productId = getStringField(form, 'productId').trim();
  if (!productId) throw new Error('상품 ID가 없습니다.');

  const cnSourceUrl = getOptionalStringField(form, 'cnSourceUrl');
  const planAssigneeIdRaw = getOptionalStringField(form, 'planAssigneeId');
  const listingAssigneeIdRaw = getOptionalStringField(form, 'listingAssigneeId');
  const rocketAssigneeIdRaw = getOptionalStringField(form, 'rocketAssigneeId');

  const ctx = await requireCompanyContext();
  assertManager(ctx.role, '담당자 배정 및 워크플로우 편집');

  try {
    await updateProduct({
      companyId: ctx.companyId,
      productId,
      cnSourceUrl,
      planAssigneeId: planAssigneeIdRaw,
      listingAssigneeId: listingAssigneeIdRaw,
      rocketAssigneeId: rocketAssigneeIdRaw,
    });
  } catch (err) {
    console.error('[updateWorkflowAction] 저장 실패:', err);
    throw new Error(
      err instanceof Error
        ? `저장 실패: ${err.message}`
        : '저장 중 오류가 발생했습니다.',
    );
  }

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?flash=workflow-saved`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 기획서 저장 (Step 4)
// ─────────────────────────────────────────────────────────

/**
 * 상세페이지 기획서 upsert.
 * /products/[id]/plan 폼에서 호출.
 *
 * 폼 필드:
 * - productId
 * - hookSummary, targetAudience, notes (텍스트)
 * - sectionsJson (JSON 문자열 — 섹션 배열)
 * - resultConfidence ('estimated' | 'edited' | 'confirmed')
 */
export async function savePlanAction(form: FormData): Promise<void> {
  const productId = getStringField(form, 'productId').trim();
  if (!productId) throw new Error('상품 ID가 없습니다.');

  const hookSummary = getOptionalStringField(form, 'hookSummary');
  const targetAudience = getOptionalStringField(form, 'targetAudience');
  const notes = getOptionalStringField(form, 'notes');
  const sectionsJsonRaw = getStringField(form, 'sectionsJson').trim();
  const confidenceRaw = getStringField(form, 'resultConfidence').trim();

  // 섹션 JSON 파싱 — 실패하면 비어있는 배열로 처리 (부분 저장 허용)
  let sections: PlanSection[] = [];
  if (sectionsJsonRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(sectionsJsonRaw);
      if (Array.isArray(parsed)) {
        sections = parsed as PlanSection[];
      }
    } catch {
      throw new Error('섹션 JSON 형식이 올바르지 않습니다. JSON 배열이어야 합니다.');
    }
  }

  const resultConfidence =
    confidenceRaw === 'edited' || confidenceRaw === 'confirmed'
      ? confidenceRaw
      : 'estimated';

  const ctx = await requireCompanyContext();

  const product = await getProductById(ctx.companyId, productId);
  if (!product) throw new Error('상품을 찾을 수 없습니다.');
  assertCanEditPlan(ctx.role, product, ctx.userId);

  try {
    await upsertPlan({
      companyId: ctx.companyId,
      productId,
      userId: ctx.userId,
      sections,
      hookSummary,
      targetAudience,
      notes,
      resultConfidence,
    });
  } catch (err) {
    console.error('[savePlanAction] 저장 실패:', err);
    throw new Error(
      err instanceof Error
        ? `기획서 저장 실패: ${err.message}`
        : '기획서 저장 중 오류가 발생했습니다.',
    );
  }

  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/plan`);
  redirect(`/products/${productId}/plan?flash=plan-saved`);
}

/**
 * 원가/판매가/마진율을 상품에 저장.
 * CostCalculator 컴포넌트의 hidden input으로 전달됨.
 */
export async function savePricingAction(form: FormData): Promise<void> {
  const productId = getStringField(form, 'productId').trim();
  if (!productId) {
    throw new Error('상품 ID가 없습니다.');
  }

  const cogsKrw = parseDecimalField(form, 'cogsKrw');
  const sellingPriceKrw = parseDecimalField(form, 'sellingPriceKrw');
  const marginRateRaw = parseDecimalField(form, 'marginRate');

  const ctx = await requireCompanyContext();
  assertManager(ctx.role, '가격·원가 저장');

  try {
    await updateProduct({
      companyId: ctx.companyId,
      productId,
      cogsCny: null,
      sellingPriceKrw: sellingPriceKrw,
      marginRate: marginRateRaw,
    });

    // cogs_krw는 별도 컬럼이므로 직접 업데이트
    if (cogsKrw !== null) {
      const { withCompanyContext } = await import('@/db');
      const { products } = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');
      await withCompanyContext(ctx.companyId, async (tx) => {
        await tx
          .update(products)
          .set({ cogs_krw: String(cogsKrw), updated_at: new Date() })
          .where(and(eq(products.id, productId), eq(products.company_id, ctx.companyId)));
      });
    }
  } catch (err) {
    console.error('[savePricingAction] 저장 실패:', err);
    throw new Error(
      err instanceof Error
        ? `가격 저장 실패: ${err.message}`
        : '가격 저장 중 오류가 발생했습니다.',
    );
  }

  revalidatePath('/sourcing');
  revalidatePath('/products');
  revalidatePath(`/products/${productId}`);
}
