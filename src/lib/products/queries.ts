/**
 * 상품(products) 도메인 — 조회 헬퍼
 *
 * 출처: src/db/schema/products.ts, docs/DATA_MODEL.md §3.1
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-1 (빈 결과 은폐 금지), §1 P-3 (estimated 마킹)
 *
 * 역할:
 * - 회사 + 단계별 상품 목록
 * - 상품 단건 상세
 * - 상품 코드로 조회 (중복 체크용)
 * - 상품 상태별 카운트
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS 자동 적용.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { products, type Product } from '@/db/schema';

import {
  PIPELINE_STAGES,
  type PipelineStage,
} from './constants';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// ─────────────────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────────────────

export interface ListProductsParams {
  companyId: string;
  /** 특정 단계만. 빈 배열 / undefined면 전체. */
  stages?: PipelineStage[];
  limit?: number;
}

// ─────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────

function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * URL 검색 파라미터에서 stage 필터 파싱.
 * 예: ?stage=research,sourcing → ['research','sourcing']
 * 잘못된 값은 조용히 무시.
 */
export function parsePipelineStageFilter(raw: string | null | undefined): PipelineStage[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PipelineStage => isPipelineStage(s));
}

// ─────────────────────────────────────────────────────────
// 조회 — 목록
// ─────────────────────────────────────────────────────────

/**
 * 회사의 상품 목록 (최신 등록순).
 */
export async function listProducts(params: ListProductsParams): Promise<Product[]> {
  if (!params.companyId) {
    throw new Error('[listProducts] companyId가 필요합니다.');
  }
  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const conditions = [eq(products.company_id, params.companyId)];
    if (params.stages && params.stages.length > 0) {
      conditions.push(inArray(products.status, params.stages));
    }

    const rows = await tx
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.created_at))
      .limit(limit);
    return rows;
  });
}

/**
 * 회사의 상품 단계별 카운트 (필터 칩용).
 */
export async function countProductsByStage(
  companyId: string,
): Promise<Record<PipelineStage, number>> {
  if (!companyId) {
    throw new Error('[countProductsByStage] companyId가 필요합니다.');
  }

  const initial: Record<PipelineStage, number> = {
    research: 0,
    sourcing: 0,
    importing: 0,
    listing: 0,
    active: 0,
  };

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ stage: products.status, n: count() })
      .from(products)
      .where(eq(products.company_id, companyId))
      .groupBy(products.status);

    for (const row of rows) {
      if (isPipelineStage(row.stage)) {
        initial[row.stage] = Number(row.n);
      }
    }
    return initial;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 단건
// ─────────────────────────────────────────────────────────

export async function getProductById(
  companyId: string,
  productId: string,
): Promise<Product | null> {
  if (!companyId || !productId) {
    throw new Error('[getProductById] companyId와 productId가 필요합니다.');
  }
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
    return rows[0] ?? null;
  });
}

/**
 * 상품 코드로 조회 — 신규 등록 시 코드 중복 체크용.
 */
export async function getProductByCode(
  companyId: string,
  code: string,
): Promise<Product | null> {
  if (!companyId || !code) {
    throw new Error('[getProductByCode] companyId와 code가 필요합니다.');
  }
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(products)
      .where(and(eq(products.company_id, companyId), eq(products.code, code)))
      .limit(1);
    return rows[0] ?? null;
  });
}
