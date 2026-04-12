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

import { requireCompanyContext } from '@/lib/auth/session';

import { type ProductActionState, type ProductFieldKey } from './action-types';
import { CONFIDENCE_LEVELS, PIPELINE_STAGES, type ConfidenceLevel, type PipelineStage } from './constants';
import { createProduct, updateProduct, suggestNextProductCode } from './mutations';
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
  redirect(`/products/${productId}`);
}

// ─────────────────────────────────────────────────────────
// 액션 — 장바구니 빠른 추가 (상품 발굴용)
// ─────────────────────────────────────────────────────────

/**
 * research 페이지 장바구니에서 호출.
 * 이름만으로 빠르게 상품 등록 (코드 자동 생성, status = 'research').
 * sourceUrl, memo는 description에 저장.
 */
export async function quickAddToBasketAction(form: FormData): Promise<void> {
  const name = getStringField(form, 'name').trim();
  const sourceUrl = getOptionalStringField(form, 'sourceUrl');
  const memo = getOptionalStringField(form, 'memo');

  if (name.length === 0) {
    throw new Error('상품 이름을 입력해주세요.');
  }

  const ctx = await requireCompanyContext();

  // 코드 자동 생성
  let code: string;
  try {
    code = await suggestNextProductCode(ctx.companyId);
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
      companyId: ctx.companyId,
      code,
      name,
      description,
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
}

// ─────────────────────────────────────────────────────────
// 액션 — 가격 정보 저장 (계산기에서 호출)
// ─────────────────────────────────────────────────────────

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
