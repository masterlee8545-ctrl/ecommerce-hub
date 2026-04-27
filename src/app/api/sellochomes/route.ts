/**
 * /api/sellochomes — 셀록홈즈 카테고리 소싱 프록시
 *
 * GET ?path=<카테고리경로>       — 해당 카테고리 전체 키워드 (페이지네이션 합산) + 카테고리 트리
 * GET (path 없음)                 — 대분류만 반환 (트리 최상단)
 *
 * 예: /api/sellochomes?path=식품>농산물>과일 → 438개 키워드 + 4단계 트리
 */
import { NextResponse, type NextRequest } from 'next/server';

import { requireCompanyContext } from '@/lib/auth/session';
import {
  fetchAllCategoryKeywords,
  resolveCategoryPath,
  SellochomesError,
  type SCKeyword,
} from '@/lib/sellochomes/client';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL = 500;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SuccessResponse {
  ok: true;
  categoryId: string | null;
  path: string;
  tree: Array<{ level: number; reps: string; items: Array<{ name: string; id: string }> }>;
  keywords: SCKeyword[] | null; //  path 있을 때만
}

export async function GET(request: NextRequest) {
  await requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path')?.trim() ?? '';

  try {
    // 셀록홈즈 API 는 빈 경로에 "비정상 요청" 응답 → 빈 상태일 땐 식품으로 bootstrap
    // (식품은 대분류 1개라 요청 안정적. 실제 반환되는 setCategory_Info 에는 대분류 10개 포함)
    const probePath = path.length > 0 ? path : '식품';
    const resolved = await resolveCategoryPath(probePath);

    // setCategory_Info 를 배열 형태로 정규화 — 대분류만 남기거나 전체 트리
    const allLevels = Object.entries(resolved.setCategory_Info)
      .map(([lvl, node]) => ({
        level: Number(lvl),
        reps: (node as { reps?: string }).reps ?? '',
        // 일부 레벨(2, 3)은 빈 객체 {} 로 응답 → catelist 가 undefined. 가드 필수.
        items: Array.isArray((node as { catelist?: unknown[] }).catelist)
          ? ((node as { catelist: Array<{ name: string; cate_id: string }> }).catelist).map((c) => ({
              name: c.name,
              id: c.cate_id,
            }))
          : [],
      }))
      .filter((lvl) => lvl.items.length > 0) // 빈 레벨은 숨김
      .sort((a, b) => a.level - b.level);

    // bootstrap 모드에선 대분류(level=0)만 리턴
    const tree = path.length === 0 ? allLevels.slice(0, 1) : allLevels;

    // path 가 있고 실제 queryCategoryId 가 있으면 키워드 로드 (bootstrap 은 스킵)
    let keywords: SCKeyword[] | null = null;
    let categoryId: string | null = null;
    if (path.length > 0 && resolved.queryCategoryId) {
      categoryId = resolved.queryCategoryId;
      keywords = await fetchAllCategoryKeywords(categoryId);
    }

    const body: SuccessResponse = {
      ok: true,
      categoryId,
      path,
      tree,
      keywords,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof SellochomesError) {
      const status =
        err.code === 'no_cookie' || err.code === 'auth_expired'
          ? HTTP_UNAUTHORIZED
          : err.code === 'category_not_found'
            ? HTTP_NOT_FOUND
            : err.code === 'network'
              ? HTTP_BAD_REQUEST
              : HTTP_INTERNAL;
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status });
    }
    console.error('[api/sellochomes] 실패:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: HTTP_INTERNAL },
    );
  }
}
