/**
 * /api/sellochomes/keyword-reviews?keyword=<검색어>[&threshold=500&majority=10]
 *
 * 셀록홈즈 쿠팡 키워드 1페이지 상품을 직접 API 로 조회 → 리뷰 분포 계산.
 *
 * 응답:
 *   { ok: true, distribution: ReviewDistribution }
 *
 * 사용량:
 *   셀록홈즈 구독 사용량 1회 차감 (사장님 한도 내). 카테고리 표에서 키워드별
 *   "분석" 버튼 누를 때만 호출 — 자동 일괄은 사장님이 명시적으로 트리거.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireCompanyContext } from '@/lib/auth/session';
import {
  analyzeReviewDistribution,
  fetchCoupangKeywordInfo,
  SellochomesError,
} from '@/lib/sellochomes/client';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_INTERNAL = 500;
const DEFAULT_THRESHOLD = 500;
const DEFAULT_MAJORITY = 10;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const threshold = Number(searchParams.get('threshold') ?? DEFAULT_THRESHOLD);
  const majority = Number(searchParams.get('majority') ?? DEFAULT_MAJORITY);

  if (!keyword) {
    return NextResponse.json(
      { ok: false, error: 'keyword 파라미터가 필요합니다.' },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    const response = await fetchCoupangKeywordInfo(keyword);
    const distribution = analyzeReviewDistribution(response, keyword, {
      threshold,
      majorityCount: majority,
    });
    return NextResponse.json({ ok: true, distribution });
  } catch (err) {
    if (err instanceof SellochomesError) {
      const status =
        err.code === 'no_cookie' || err.code === 'auth_expired'
          ? HTTP_UNAUTHORIZED
          : err.code === 'network'
            ? HTTP_BAD_REQUEST
            : HTTP_INTERNAL;
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status },
      );
    }
    console.error('[api/sellochomes/keyword-reviews] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
