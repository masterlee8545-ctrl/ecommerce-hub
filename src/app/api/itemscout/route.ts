/**
 * /api/itemscout — 아이템 스카우트 API 프록시
 *
 * 헌법: CLAUDE.md §1 P-2 (에러 명시), §1 P-4 (인증 강제)
 *
 * 역할:
 * - 클라이언트 → 서버 프록시 (i_token이 클라이언트에 노출 안 됨)
 * - action 파라미터로 분기: categories | subcategories | keywords | trending
 *
 * 인증:
 * - NextAuth 세션 확인 (로그인 필수)
 */
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth/auth';
import {
  getCoupangTopCategories,
  getCoupangTopCategoriesWithPreview,
  getSubcategories,
  getCategoryKeywords,
  getTrendingKeywords,
} from '@/lib/itemscout/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  // 인증 확인
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: '로그인이 필요합니다.' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'categories': {
        const categories = await getCoupangTopCategories();
        return NextResponse.json({ data: categories });
      }

      case 'categories-with-preview': {
        // ItemScout API 의 대분류 라벨이 실제 하위와 불일치하는 문제 회피용.
        // 15개 대분류 각각의 subcategories 를 병렬로 호출 → 첫 3개 이름을 preview 로 붙여 반환.
        const categories = await getCoupangTopCategoriesWithPreview();
        return NextResponse.json({ data: categories });
      }

      case 'subcategories': {
        const id = Number(searchParams.get('id'));
        if (!Number.isFinite(id) || id <= 0) {
          return NextResponse.json(
            { error: '유효하지 않은 카테고리 ID입니다.' },
            { status: 400 },
          );
        }
        const subs = await getSubcategories(id);
        return NextResponse.json({ data: subs });
      }

      case 'keywords': {
        const id = Number(searchParams.get('id'));
        if (!Number.isFinite(id) || id <= 0) {
          return NextResponse.json(
            { error: '유효하지 않은 카테고리 ID입니다.' },
            { status: 400 },
          );
        }
        const keywords = await getCategoryKeywords(id);
        return NextResponse.json({ data: keywords });
      }

      case 'trending': {
        const trending = await getTrendingKeywords();
        return NextResponse.json({ data: trending });
      }

      default:
        return NextResponse.json(
          { error: `알 수 없는 action: ${action ?? '(없음)'}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[api/itemscout] 오류:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : '아이템스카우트 데이터를 불러올 수 없습니다.',
      },
      { status: 500 },
    );
  }
}
