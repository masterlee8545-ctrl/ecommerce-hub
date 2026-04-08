/**
 * 쿠팡 리뷰 분석 결과 — DB 저장 / 조회 라이브러리
 *
 * 출처: src/db/schema/research-review-analyses.ts (D-1a)
 * 헌법: CLAUDE.md §1 P-3 (estimated 마킹), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-1 (빈 결과 은폐 금지)
 *
 * 역할:
 * - saveAnalysis(): 분석기 결과를 research_review_analyses 표에 저장
 * - listRecentAnalyses(): 회사별 최근 분석 목록 (히스토리 페이지)
 * - getAnalysisById(): 단일 분석 상세 (상세 페이지)
 *
 * 모든 함수는 withCompanyContext 안에서 실행 — RLS가 자동으로 다른 회사 차단.
 *
 * 신뢰도 (P-3):
 * - 저장 시 confidence는 항상 'estimated' (DB CHECK 제약 + 코드 강제)
 * - DB CHECK가 잘못 들어오는 값을 INSERT 단계에서 거부
 */
import { desc, eq } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { researchReviewAnalyses, type ResearchReviewAnalysis } from '@/db/schema';

import type { AnalyzeResult } from './coupang-review-analyzer';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

/** raw_text_excerpt 컬럼에 저장할 최대 문자 수 (전체 원문 보관 금지) */
const RAW_TEXT_EXCERPT_LIMIT = 500;

/** listRecentAnalyses 기본 limit */
const DEFAULT_LIST_LIMIT = 20;

/** listRecentAnalyses 최대 limit (안전 가드) */
const MAX_LIST_LIMIT = 100;

// ─────────────────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────────────────

export interface SaveAnalysisInput {
  /** 회사 ID — withCompanyContext의 RLS 키 */
  companyId: string;
  /** 작성자 (선택 — 익명 자동 분석은 null) */
  createdBy?: string | null;
  /** 사용자 입력 원문 (전체) — 앞 500자만 저장됨 */
  rawText: string;
  /** 카테고리 힌트 */
  productHint?: string | null;
  /** AI 모델명 (예: 'claude-opus-4-5') */
  model: string;
  /** AI 분석 결과 (이미 zod 검증 완료) */
  result: AnalyzeResult;
}

export interface ListAnalysesParams {
  companyId: string;
  /** 가져올 개수 (기본 20, 최대 100) */
  limit?: number;
}

// ─────────────────────────────────────────────────────────
// 저장
// ─────────────────────────────────────────────────────────

/**
 * 분석 결과 한 건 저장.
 *
 * 안전성:
 * - confidence 컬럼은 항상 'estimated' (코드 + DB CHECK 이중 강제)
 * - raw_text_excerpt는 앞 500자로 자동 자름
 * - withCompanyContext 안에서만 INSERT 가능 (RLS)
 *
 * @returns 생성된 행의 ID
 * @throws Error — 회사 컨텍스트 없음, 입력 검증 실패, DB 에러 (P-2: 은폐 금지)
 */
export async function saveAnalysis(input: SaveAnalysisInput): Promise<{ id: string }> {
  if (!input.companyId) {
    throw new Error('[saveAnalysis] companyId가 필요합니다.');
  }
  if (!input.rawText || input.rawText.length === 0) {
    throw new Error('[saveAnalysis] rawText가 비어 있습니다.');
  }
  if (!input.model || input.model.length === 0) {
    throw new Error('[saveAnalysis] model이 비어 있습니다.');
  }
  // P-3 — 코드 레벨에서도 한번 더 강제 (DB CHECK가 백업)
  if (input.result.confidence !== 'estimated') {
    throw new Error(
      `[saveAnalysis] confidence는 반드시 'estimated'여야 합니다. 받은 값: ${input.result.confidence}`,
    );
  }

  return withCompanyContext(input.companyId, async (tx) => {
    const inserted = await tx
      .insert(researchReviewAnalyses)
      .values({
        company_id: input.companyId,
        created_by: input.createdBy ?? null,
        product_hint: input.productHint ?? null,
        raw_text_excerpt: input.rawText.slice(0, RAW_TEXT_EXCERPT_LIMIT),
        raw_text_length: input.rawText.length,
        result: input.result,
        model: input.model,
        confidence: 'estimated',
      })
      .returning({ id: researchReviewAnalyses.id });

    const row = inserted[0];
    if (!row) {
      throw new Error('[saveAnalysis] INSERT가 행을 반환하지 않았습니다.');
    }
    return { id: row.id };
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 목록
// ─────────────────────────────────────────────────────────

/**
 * 회사의 최근 분석 목록 조회.
 *
 * 정렬: created_at DESC (최신순)
 * 인덱스: rra_company_created_idx (company_id, created_at)
 *
 * @returns 최대 `limit`개 (기본 20)
 */
export async function listRecentAnalyses(
  params: ListAnalysesParams,
): Promise<ResearchReviewAnalysis[]> {
  if (!params.companyId) {
    throw new Error('[listRecentAnalyses] companyId가 필요합니다.');
  }

  const requested = params.limit ?? DEFAULT_LIST_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIST_LIMIT);

  return withCompanyContext(params.companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(researchReviewAnalyses)
      .where(eq(researchReviewAnalyses.company_id, params.companyId))
      .orderBy(desc(researchReviewAnalyses.created_at))
      .limit(limit);
    return rows;
  });
}

// ─────────────────────────────────────────────────────────
// 조회 — 단건
// ─────────────────────────────────────────────────────────

/**
 * 단일 분석 상세 조회.
 *
 * 안전성: RLS가 다른 회사 데이터를 자동 차단 — 다른 회사 ID로는 절대 조회 불가능.
 *
 * @returns 행 또는 null (RLS에 막혔거나 진짜 없음 — 호출자 입장에선 둘 다 동일)
 */
export async function getAnalysisById(
  companyId: string,
  analysisId: string,
): Promise<ResearchReviewAnalysis | null> {
  if (!companyId || !analysisId) {
    throw new Error('[getAnalysisById] companyId와 analysisId가 필요합니다.');
  }

  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(researchReviewAnalyses)
      .where(eq(researchReviewAnalyses.id, analysisId))
      .limit(1);
    return rows[0] ?? null;
  });
}
