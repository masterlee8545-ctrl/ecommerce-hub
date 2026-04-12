/**
 * /research — 상품 발굴 (장바구니 + 검증 도구)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 아이템 스카우트 등에서 찾은 상품을 빠르게 장바구니에 담기
 * - 장바구니 목록 확인 + 검증 후 "수입 의뢰"로 넘기기
 * - 쿠팡 리뷰 분석 등 검증 도구 바로가기
 */
import Link from 'next/link';

import {
  ArrowRight,
  ExternalLink,
  FileSearch,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { quickAddToBasketAction, transitionProductStatusAction } from '@/lib/products/actions';
import { listProducts } from '@/lib/products/queries';

export const dynamic = 'force-dynamic';

const BASKET_LIMIT = 50;

export default async function ResearchPage() {
  const ctx = await requireCompanyContext();

  // research 단계 상품 = 장바구니
  let basketItems: Awaited<ReturnType<typeof listProducts>> = [];
  let dbError: string | null = null;
  try {
    basketItems = await listProducts({
      companyId: ctx.companyId,
      stages: ['research'],
      limit: BASKET_LIMIT,
    });
  } catch (err) {
    console.error('[research] 장바구니 조회 실패:', err);
    dbError =
      err instanceof Error ? err.message : '장바구니를 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-600">
          <Search className="h-4 w-4" aria-hidden />
          Step 1
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">상품 발굴</h1>
        <p className="mt-1 text-sm text-navy-500">
          아이템 스카우트, 쿠팡, 1688 등에서 찾은 상품을 장바구니에 담아두세요.
          검증이 끝나면 수입 의뢰로 넘깁니다.
        </p>
      </header>

      {/* 빠른 추가 폼 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-900">
          <Plus className="h-4 w-4 text-blue-600" />
          장바구니에 추가
        </h2>
        <form action={quickAddToBasketAction} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-navy-700">
                상품명 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                placeholder="예: 실리콘 마늘 다지기"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label htmlFor="sourceUrl" className="block text-xs font-semibold text-navy-700">
                소스 URL (선택)
              </label>
              <input
                type="url"
                id="sourceUrl"
                name="sourceUrl"
                placeholder="쿠팡/1688/아이템스카우트 링크"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="memo" className="block text-xs font-semibold text-navy-700">
              메모 (선택)
            </label>
            <input
              type="text"
              id="memo"
              name="memo"
              placeholder="검색량, 경쟁강도, 특이사항 등 한줄 메모"
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <ShoppingCart className="h-4 w-4" />
            장바구니에 담기
          </button>
        </form>
      </section>

      {/* 장바구니 목록 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
            장바구니 ({basketItems.length}개)
          </h2>
          {basketItems.length > 0 && (
            <Link
              href="/products?stage=research"
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              상세 목록 →
            </Link>
          )}
        </div>

        {dbError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
            <div className="font-semibold">장바구니를 불러올 수 없습니다</div>
            <p className="mt-1 text-xs">{dbError}</p>
            <p className="mt-2 text-[11px] text-amber-700">
              DB 연결을 확인하세요. (`npm run db:push`)
            </p>
          </div>
        ) : basketItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
            <ShoppingCart className="mx-auto h-10 w-10 text-navy-300" />
            <h3 className="mt-3 text-base font-semibold text-navy-700">
              장바구니가 비어있습니다
            </h3>
            <p className="mt-1 text-xs text-navy-500">
              위 폼에서 상품을 추가하면 여기에 표시됩니다.
              아이템 스카우트에서 찾은 상품 이름을 넣어보세요.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {basketItems.map((item) => (
              <BasketCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {/* 검증 도구 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
          검증 도구
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Link
            href="/research/coupang-reviews"
            className="flex items-center gap-3 rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50">
              <FileSearch className="h-5 w-5 text-teal-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-900">쿠팡 리뷰 분석</div>
              <div className="text-xs text-navy-500">
                1페이지 리뷰를 분석해 진입 가능성 확인
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-navy-200 bg-navy-50/20 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-100">
              <Sparkles className="h-5 w-5 text-navy-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-500">디자인 특허 확인</div>
              <div className="text-xs text-navy-400">
                키프리스 조회 기능 (준비중)
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 장바구니 카드
// ─────────────────────────────────────────────────────────

interface BasketCardProps {
  item: Awaited<ReturnType<typeof listProducts>>[number];
}

function BasketCard({ item }: BasketCardProps) {
  // description에서 소스 URL 추출
  const lines = (item.description ?? '').split('\n');
  const sourceLine = lines.find((l) => l.startsWith('소스: '));
  const sourceUrl = sourceLine ? sourceLine.replace('소스: ', '').trim() : null;
  const memo = lines.filter((l) => !l.startsWith('소스: ')).join(' ').trim();

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300">
      <div className="flex items-start justify-between gap-4">
        {/* 좌: 상품 정보 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/products/${item.id}`}
              className="text-sm font-semibold text-navy-900 hover:text-teal-700"
            >
              {item.name}
            </Link>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
              {item.code}
            </span>
          </div>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="h-3 w-3" />
              소스 링크
            </a>
          )}
          {memo && (
            <p className="mt-1 text-xs text-navy-500">{memo}</p>
          )}
          <div className="mt-1 text-[10px] text-navy-400">
            {formatDate(item.created_at)}
          </div>
        </div>

        {/* 우: 수입 의뢰로 넘기기 버튼 */}
        <form action={transitionProductStatusAction}>
          <input type="hidden" name="productId" value={item.id} />
          <input type="hidden" name="toStatus" value="sourcing" />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700 transition hover:bg-yellow-100"
          >
            수입 의뢰로
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
      </div>
    </li>
  );
}

function formatDate(date: Date): string {
  try {
    return date.toLocaleDateString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(date);
  }
}
