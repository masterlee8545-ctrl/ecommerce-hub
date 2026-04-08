/**
 * 공급사 도메인 — 쿼리 + 변경 헬퍼
 *
 * 출처: src/db/schema/suppliers.ts, docs/DATA_MODEL.md §3.5
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-1 (빈 결과 은폐 금지)
 *
 * 역할:
 * - 회사별 공급사 목록·상세 조회
 * - 새 공급사 등록
 * - 공급사 정보 수정
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS 자동 적용.
 *
 * 검증 정책:
 * - source는 'taobao' | '1688' | 'domestic' | 'other' 중 하나
 * - rating은 1~5 범위
 * - name은 비어 있을 수 없음
 */
import { count, desc, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { suppliers, type NewSupplier, type Supplier } from '@/db/schema';

import { SUPPLIER_SOURCES, type SupplierSource } from './constants';

// ─────────────────────────────────────────────────────────
// 상수 + 타입 — 클라이언트 공용 상수는 './constants'에서 re-export
// ─────────────────────────────────────────────────────────

export { SUPPLIER_SOURCES, type SupplierSource };

const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_NAME_LEN = 200;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListSuppliersParams {
  companyId: string;
  limit?: number;
}

export interface CreateSupplierInput {
  companyId: string;
  name: string;
  source: SupplierSource;
  sourceUrl?: string | null;
  contactInfo?: string | null;
  rating?: number | null;
  notes?: string | null;
}

export interface UpdateSupplierInput {
  companyId: string;
  supplierId: string;
  name?: string;
  source?: SupplierSource;
  sourceUrl?: string | null;
  contactInfo?: string | null;
  rating?: number | null;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function validateName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('[suppliers] 공급사 이름이 비어 있습니다.');
  }
  if (trimmed.length > MAX_NAME_LEN) {
    throw new Error(`[suppliers] 공급사 이름이 너무 깁니다 (최대 ${MAX_NAME_LEN}자).`);
  }
}

function validateSource(source: string): asserts source is SupplierSource {
  if (!SUPPLIER_SOURCES.includes(source as SupplierSource)) {
    throw new Error(
      `[suppliers] source가 유효하지 않습니다: ${source}. 허용값: ${SUPPLIER_SOURCES.join(', ')}`,
    );
  }
}

function validateRating(rating: number | null | undefined): void {
  if (rating === null || rating === undefined) return;
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw new Error(
      `[suppliers] rating은 ${MIN_RATING}~${MAX_RATING} 사이의 정수여야 합니다. 받은 값: ${rating}`,
    );
  }
}

// ─────────────────────────────────────────────────────────
// 조회 — 목록
// ─────────────────────────────────────────────────────────

/**
 * 회사의 공급사 목록 조회 (최신 등록순).
 */
export async function listSuppliers(params: ListSuppliersParams): Promise<Supplier[]> {
  if (!params.companyId) {
    throw new Error('[listSuppliers] companyId가 필요합니다.');
  }
  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.company_id, params.companyId))
      .orderBy(desc(suppliers.created_at))
      .limit(limit);
    return rows;
  });
}

/**
 * 회사의 공급사 총 개수 (KPI 카드용).
 */
export async function countSuppliers(companyId: string): Promise<number> {
  if (!companyId) return 0;
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(suppliers)
      .where(eq(suppliers.company_id, companyId));
    return Number(rows[0]?.n ?? 0);
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 단건
// ─────────────────────────────────────────────────────────

export async function getSupplierById(
  companyId: string,
  supplierId: string,
): Promise<Supplier | null> {
  if (!companyId || !supplierId) {
    throw new Error('[getSupplierById] companyId와 supplierId가 필요합니다.');
  }
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .limit(1);
    return rows[0] ?? null;
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 생성
// ─────────────────────────────────────────────────────────

export async function createSupplier(input: CreateSupplierInput): Promise<{ id: string }> {
  if (!input.companyId) {
    throw new Error('[createSupplier] companyId가 필요합니다.');
  }
  validateName(input.name);
  validateSource(input.source);
  validateRating(input.rating);

  const values: NewSupplier = {
    company_id: input.companyId,
    name: input.name.trim(),
    source: input.source,
    source_url: input.sourceUrl?.trim() || null,
    contact_info: input.contactInfo?.trim() || null,
    rating: input.rating ?? null,
    notes: input.notes?.trim() || null,
  };

  return withCompanyContext(input.companyId, async (tx) => {
    const inserted = await tx
      .insert(suppliers)
      .values(values)
      .returning({ id: suppliers.id });
    const row = inserted[0];
    if (!row) {
      throw new Error('[createSupplier] INSERT가 행을 반환하지 않았습니다.');
    }
    return { id: row.id };
  });
}

// ─────────────────────────────────────────────────────────
// 변경 — 업데이트
// ─────────────────────────────────────────────────────────

export async function updateSupplier(input: UpdateSupplierInput): Promise<void> {
  if (!input.companyId || !input.supplierId) {
    throw new Error('[updateSupplier] companyId와 supplierId가 필요합니다.');
  }

  if (input.name !== undefined) validateName(input.name);
  if (input.source !== undefined) validateSource(input.source);
  if (input.rating !== undefined) validateRating(input.rating);

  const patch: Partial<NewSupplier> = {
    updated_at: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.source !== undefined) patch.source = input.source;
  if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl?.trim() || null;
  if (input.contactInfo !== undefined) patch.contact_info = input.contactInfo?.trim() || null;
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  await withCompanyContext(input.companyId, async (tx) => {
    await tx.update(suppliers).set(patch).where(eq(suppliers.id, input.supplierId));
  });
}
