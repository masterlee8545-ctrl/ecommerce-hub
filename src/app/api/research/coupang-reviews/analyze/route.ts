/**
 * POST /api/research/coupang-reviews/analyze — 쿠팡 리뷰 분석 엔드포인트
 *
 * 출처: docs/SPEC.md §3 Research 단계, D-1 (저장 추가)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어 메시지), §1 P-3 (estimated 마킹)
 *
 * 역할:
 * - 사용자가 붙여넣은 쿠팡 리뷰 텍스트를 받아 Claude로 분석
 * - 결과를 구조화된 JSON으로 반환
 * - **D-1 추가**: 분석 성공 시 research_review_analyses 표에 저장 (현재 회사 컨텍스트)
 *
 * 보안:
 * - requireCompanyContext()로 인증 + 회사 컨텍스트 검증
 * - 인증 실패 시 자동 /login 리디렉션
 * - 저장은 withCompanyContext 통해 RLS 자동 적용 (P-4)
 *
 * 응답:
 * - 200 OK: { ok: true, result, savedId }
 * - 422 Unprocessable Entity: 입력 검증 실패 (zod)
 * - 500 Internal Server Error: Claude 호출 실패
 * - 503 Service Unavailable: ANTHROPIC_API_KEY 미설정
 *
 * 저장 실패 처리 (P-1):
 * - 분석은 성공했는데 저장만 실패한 경우 → 결과는 그대로 반환하되 savedId 없이 + warning 필드
 * - 사용자가 화면에서 결과는 볼 수 있고, 저장 실패는 명시적으로 표시
 */
import { NextResponse } from 'next/server';

import { ZodError } from 'zod';

import { requireCompanyContext } from '@/lib/auth/session';
import {
  analyzeCoupangReviews,
  AnalyzeInputSchema,
  CoupangReviewAnalyzerError,
} from '@/lib/research/coupang-review-analyzer';
import { saveAnalysis } from '@/lib/research/storage';

const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-4-5';

// HTTP 상태 코드 상수 (no-magic-numbers)
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE_ENTITY = 422;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;

// API 라우트는 항상 동적 (POST + 인증)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST 핸들러.
 *
 * 요청 본문 예:
 * ```json
 * {
 *   "rawText": "⭐⭐⭐⭐⭐ 정말 좋아요\n배송도 빠르고...",
 *   "productHint": "실리콘 주방 용품"
 * }
 * ```
 */
export async function POST(request: Request): Promise<NextResponse> {
  // 1) 인증 — 미인증이면 자동으로 /login 리디렉션 발생 + 회사 컨텍스트 확보
  const ctx = await requireCompanyContext();

  // 2) JSON 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'JSON 본문을 읽을 수 없습니다. Content-Type: application/json 인지 확인하세요.',
      },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // 3) zod 입력 검증
  let parsed;
  try {
    parsed = AnalyzeInputSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: '입력값이 올바르지 않습니다.',
          details: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: HTTP_UNPROCESSABLE_ENTITY },
      );
    }
    throw err;
  }

  // 4) 분석기 호출 + (성공 시) DB 저장
  try {
    const result = await analyzeCoupangReviews(parsed);

    // 4-1) DB 저장 시도 — 실패해도 분석 결과는 반환 (P-1: 결과 은폐 금지)
    let savedId: string | null = null;
    let saveWarning: string | null = null;
    try {
      const saved = await saveAnalysis({
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        rawText: parsed.rawText,
        productHint: parsed.productHint ?? null,
        model: process.env['ANTHROPIC_MODEL'] ?? ANTHROPIC_DEFAULT_MODEL,
        result,
      });
      savedId = saved.id;
    } catch (saveErr) {
      console.error('[api/research/coupang-reviews/analyze] DB 저장 실패:', saveErr);
      saveWarning =
        '분석은 완료됐지만 결과가 저장되지 않았습니다. 새로고침하면 사라지니 메모해두세요.';
    }

    return NextResponse.json(
      { ok: true, result, savedId, saveWarning },
      { status: HTTP_OK },
    );
  } catch (err) {
    if (err instanceof CoupangReviewAnalyzerError) {
      // 'config' 단계 실패 → 503 (운영자 설정 문제)
      if (err.stage === 'config') {
        return NextResponse.json(
          {
            ok: false,
            error: 'AI 분석 서버가 아직 준비되지 않았습니다. 관리자에게 문의해주세요.',
            stage: err.stage,
          },
          { status: HTTP_SERVICE_UNAVAILABLE },
        );
      }
      // 'input' 단계 실패 → 422
      if (err.stage === 'input') {
        return NextResponse.json(
          { ok: false, error: err.message, stage: err.stage },
          { status: HTTP_UNPROCESSABLE_ENTITY },
        );
      }
      // 'api' / 'parse' 단계 실패 → 500
      console.error('[api/research/coupang-reviews/analyze] Claude 호출 실패:', err);
      return NextResponse.json(
        {
          ok: false,
          error: 'AI 분석 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
          stage: err.stage,
        },
        { status: HTTP_INTERNAL_SERVER_ERROR },
      );
    }

    // 예상치 못한 에러 — P-2: 은폐 금지
    console.error('[api/research/coupang-reviews/analyze] 예상치 못한 에러:', err);
    return NextResponse.json(
      {
        ok: false,
        error: '서버 내부 오류가 발생했습니다.',
      },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }
}
