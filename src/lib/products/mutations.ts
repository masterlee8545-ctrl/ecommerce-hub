/**
 * 상품(products) 도메인 — 변경 헬퍼 (생성/수정)
 *
 * 출처: src/db/schema/products.ts (D-2a 패턴)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-3 (estimated 강제),
 *       §1 P-4 (멀티테넌트 RLS)
 *
 * 역할:
 * - 신규 상품 생성 (status는 항상 'research'로 시작)
 * - 일반 정보 수정 (이름, 카테고리, 가격 등)
 *
 * status 변경은 별도 transitions.ts에서 처리 (ADR-005 자동 task 생성 포함).
 *
 * 신뢰도 정책 (P-3):
 * - cogs_cny가 있는데 cogs_cny_confidence가 없으면 자동으로 'estimated' 적용
 * - margin_rate도 동일
 * - confidence는 'confirmed' | 'estimated' | 'unknown' 중 하나만
 */
import { and, eq, sql } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { products, type NewProduct } from '@/db/schema';

import {
  CONFIDENCE_LEVELS,
  type ConfidenceLevel,
} from './constants';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const MAX_NAME_LEN = 200;
const MAX_CODE_LEN = 50;
const MIN_CODE_LEN = 1;

// ─────────────────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────────────────

export interface CreateProductInput {
  companyId: string;
  /** 회사 내 상품 코드 (예: 'PROD-2026-0042'). 회사 내 unique. */
  code: string;
  name: string;
  category?: string | null | undefined;
  description?: string | null | undefined;
  /** 원가(위안). 미정이면 null */
  cogsCny?: number | null | undefined;
  /** 원가 신뢰도 (P-3). 가격이 있으면 자동으로 'estimated' 강제 */
  cogsCnyConfidence?: ConfidenceLevel | undefined;
  /** 판매가(원). 추정값 — 회계 사용 금지 */
  sellingPriceKrw?: number | null | undefined;
  /** 마진률 (0~1). 추정값 */
  marginRate?: number | null | undefined;
  marginRateConfidence?: ConfidenceLevel | undefined;
  /** 주 공급사 (선택) */
  primarySupplierId?: string | null | undefined;
  /** 1688/타오바오 소스 URL (수입업체 인계용) */
  cnSourceUrl?: string | null | undefined;
  /** 등록자 (선택) */
  createdBy?: string | null | undefined;
  ownerUserId?: string | null | undefined;
  /** 상세페이지 기획 담당 (Step 4) */
  planAssigneeId?: string | null | undefined;
  /** 상품 등록 담당 (Step 6) */
  listingAssigneeId?: string | null | undefined;
  /** 로켓 입점 담당 (Step 8) */
  rocketAssigneeId?: string | null | undefined;
}

export interface UpdateProductInput {
  companyId: string;
  productId: string;
  name?: string | undefined;
  category?: string | null | undefined;
  description?: string | null | undefined;
  cogsCny?: number | null | undefined;
  cogsCnyConfidence?: ConfidenceLevel | undefined;
  sellingPriceKrw?: number | null | undefined;
  marginRate?: number | null | undefined;
  marginRateConfidence?: ConfidenceLevel | undefined;
  primarySupplierId?: string | null | undefined;
  cnSourceUrl?: string | null | undefined;
  ownerUserId?: string | null | undefined;
  planAssigneeId?: string | null | undefined;
  listingAssigneeId?: string | null | undefined;
  rocketAssigneeId?: string | null | undefined;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function validateName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('[products] 상품 이름이 비어 있습니다.');
  }
  if (trimmed.length > MAX_NAME_LEN) {
    throw new Error(`[products] 상품 이름이 너무 깁니다 (최대 ${MAX_NAME_LEN}자).`);
  }
}

function validateCode(code: string): void {
  const trimmed = code.trim();
  if (trimmed.length < MIN_CODE_LEN) {
    throw new Error('[products] 상품 코드가 비어 있습니다.');
  }
  if (trimmed.length > MAX_CODE_LEN) {
    throw new Error(`[products] 상품 코드가 너무 깁니다 (최대 ${MAX_CODE_LEN}자).`);
  }
}

function validateConfidence(value: string | undefined, field: string): void {
  if (value === undefined) return;
  if (!(CONFIDENCE_LEVELS as readonly string[]).includes(value)) {
    throw new Error(
      `[products] ${field}는 ${CONFIDENCE_LEVELS.join(', ')} 중 하나여야 합니다. 받은 값: ${value}`,
    );
  }
}

/**
 * 가격이 있는데 confidence가 없으면 'estimated'로 강제 (P-3 정책).
 * 가격이 null이면 confidence는 'unknown'으로.
 */
function pickConfidence(
  value: number | null | undefined,
  explicit: ConfidenceLevel | undefined,
): ConfidenceLevel {
  if (explicit !== undefined) return explicit;
  if (value === null || value === undefined) return 'unknown';
  return 'estimated';
}

// ─────────────────────────────────────────────────────────
// 변경 — 생성
// ─────────────────────────────────────────────────────────

/**
 * 새 상품 등록.
 * - status는 항상 'research'로 시작
 * - 회사 내 code unique 위반 시 DB 에러 (UNIQUE 제약)
 *
 * @returns 생성된 상품의 id + code
 */
export async function createProduct(input: CreateProductInput): Promise<{ id: string; code: string }> {
  if (!input.companyId) {
    throw new Error('[createProduct] companyId가 필요합니다.');
  }
  validateName(input.name);
  validateCode(input.code);
  validateConfidence(input.cogsCnyConfidence, 'cogs_cny_confidence');
  validateConfidence(input.marginRateConfidence, 'margin_rate_confidence');

  const cogsCnyConfidence = pickConfidence(input.cogsCny, input.cogsCnyConfidence);
  const marginRateConfidence = pickConfidence(input.marginRate, input.marginRateConfidence);

  const values: NewProduct = {
    company_id: input.companyId,
    code: input.code.trim(),
    name: input.name.trim(),
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    status: 'research',
    cogs_cny: input.cogsCny !== null && input.cogsCny !== undefined ? String(input.cogsCny) : null,
    cogs_cny_confidence: cogsCnyConfidence,
    selling_price_krw:
      input.sellingPriceKrw !== null && input.sellingPriceKrw !== undefined
        ? String(input.sellingPriceKrw)
        : null,
    margin_rate:
      input.marginRate !== null && input.marginRate !== undefined ? String(input.marginRate) : null,
    margin_rate_confidence: marginRateConfidence,
    primary_supplier_id: input.primarySupplierId ?? null,
    cn_source_url: input.cnSourceUrl?.trim() || null,
    owner_user_id: input.ownerUserId ?? null,
    plan_assignee_id: input.planAssigneeId ?? null,
    listing_assignee_id: input.listingAssigneeId ?? null,
    rocket_assignee_id: input.rocketAssigneeId ?? null,
    created_by: input.createdBy ?? null,
  };

  return withCompanyContext(input.companyId, async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(values)
      .returning({ id: products.id, code: products.code });
    const row = inserted[0];
    if (!row) {
      throw new Error('[createProduct] INSERT가 행을 반환하지 않았습니다.');
    }
    return { id: row.id, code: row.code };
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 일반 수정 (status 제외)
// ─────────────────────────────────────────────────────────

/**
 * 상품 일반 정보 수정.
 * status 변경은 transitionProductStatus를 사용해야 함 (자동 task 생성 포함).
 */
export async function updateProduct(input: UpdateProductInput): Promise<void> {
  if (!input.companyId || !input.productId) {
    throw new Error('[updateProduct] companyId와 productId가 필요합니다.');
  }
  if (input.name !== undefined) validateName(input.name);
  validateConfidence(input.cogsCnyConfidence, 'cogs_cny_confidence');
  validateConfidence(input.marginRateConfidence, 'margin_rate_confidence');

  const patch: Partial<NewProduct> = {
    updated_at: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.category !== undefined) patch.category = input.category?.trim() || null;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;

  if (input.cogsCny !== undefined) {
    patch.cogs_cny = input.cogsCny !== null ? String(input.cogsCny) : null;
    patch.cogs_cny_confidence = pickConfidence(input.cogsCny, input.cogsCnyConfidence);
  } else if (input.cogsCnyConfidence !== undefined) {
    patch.cogs_cny_confidence = input.cogsCnyConfidence;
  }

  if (input.sellingPriceKrw !== undefined) {
    patch.selling_price_krw =
      input.sellingPriceKrw !== null ? String(input.sellingPriceKrw) : null;
  }

  if (input.marginRate !== undefined) {
    patch.margin_rate = input.marginRate !== null ? String(input.marginRate) : null;
    patch.margin_rate_confidence = pickConfidence(input.marginRate, input.marginRateConfidence);
  } else if (input.marginRateConfidence !== undefined) {
    patch.margin_rate_confidence = input.marginRateConfidence;
  }

  if (input.primarySupplierId !== undefined) {
    patch.primary_supplier_id = input.primarySupplierId;
  }
  if (input.cnSourceUrl !== undefined) {
    patch.cn_source_url = input.cnSourceUrl?.trim() || null;
  }
  if (input.ownerUserId !== undefined) {
    patch.owner_user_id = input.ownerUserId;
  }
  if (input.planAssigneeId !== undefined) {
    patch.plan_assignee_id = input.planAssigneeId;
  }
  if (input.listingAssigneeId !== undefined) {
    patch.listing_assignee_id = input.listingAssigneeId;
  }
  if (input.rocketAssigneeId !== undefined) {
    patch.rocket_assignee_id = input.rocketAssigneeId;
  }

  await withCompanyContext(input.companyId, async (tx) => {
    await tx
      .update(products)
      .set(patch)
      .where(and(eq(products.id, input.productId), eq(products.company_id, input.companyId)));
  });
}

// ─────────────────────────────────────────────────────────
// 자동 코드 생성 (도우미)
// ─────────────────────────────────────────────────────────

/**
 * 회사별 다음 상품 코드 생성: 'PROD-2026-0001' 형식.
 * 같은 회사 내 가장 큰 코드를 찾고 +1.
 *
 * 주의: 동시 INSERT가 일어나면 UNIQUE 충돌이 발생할 수 있음 — 호출자가 재시도하거나
 *       사장님이 직접 코드를 지정하는 게 안전. 본 함수는 단순 편의 도우미.
 */
export async function suggestNextProductCode(companyId: string): Promise<string> {
  if (!companyId) {
    throw new Error('[suggestNextProductCode] companyId가 필요합니다.');
  }

  const year = new Date().getFullYear();
  const prefix = `PROD-${year}-`;

  return withCompanyContext(companyId, async (tx) => {
    // ILIKE 같은 prefix 매칭 — drizzle은 sql 템플릿 사용
    const rows = await tx
      .select({ code: products.code })
      .from(products)
      .where(
        and(
          eq(products.company_id, companyId),
          sql`${products.code} LIKE ${prefix + '%'}`,
        ),
      );

    let maxSeq = 0;
    for (const row of rows) {
      const tail = row.code.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed;
    }

    const SEQ_PAD = 4;
    const next = (maxSeq + 1).toString().padStart(SEQ_PAD, '0');
    return `${prefix}${next}`;
  });
}
