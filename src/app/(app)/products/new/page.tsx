/**
 * /products/new — 신규 상품 등록 페이지
 *
 * 출처: E-1d
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어), §1 P-2 (실패 시 명시)
 *
 * 역할:
 * - 서버 컴포넌트로 다음 추천 코드를 미리 계산해서 폼에 주입
 * - createProductAction을 폼에 바인딩
 *
 * 흐름:
 * 1. requireCompanyContext() — 인증 필수
 * 2. suggestNextProductCode() — PROD-2026-0001 형식
 * 3. <ProductForm action={createProductAction} mode="create" suggestedCode={...} />
 */
import Link from 'next/link';

import { ArrowLeft, PackagePlus } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { createProductAction } from '@/lib/products/actions';
import { suggestNextProductCode } from '@/lib/products/mutations';

import { ProductForm } from '../product-form';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const ctx = await requireCompanyContext();

  // 다음 추천 코드 — DB 미준비 시 폴백
  let suggestedCode = '';
  try {
    suggestedCode = await suggestNextProductCode(ctx.companyId);
  } catch (err) {
    console.error('[products/new] suggestNextProductCode 실패:', err);
    // 추천 코드 실패해도 폼은 띄움 — 사용자가 직접 입력할 수 있게
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* 상단 네비 */}
      <Link
        href="/products"
        className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 hover:text-teal-700"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        상품 목록으로
      </Link>

      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
          <PackagePlus className="h-4 w-4" aria-hidden />
          신규 상품 등록
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">새 상품 만들기</h1>
        <p className="mt-1 text-sm text-navy-500">
          상품을 등록하면 자동으로 <strong>리서치</strong> 단계에서 시작합니다. 견적이 잡히면
          소싱 단계로 진행하세요.
        </p>
      </header>

      {/* 폼 */}
      <div className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
        <ProductForm
          action={createProductAction}
          mode="create"
          suggestedCode={suggestedCode}
        />
      </div>
    </div>
  );
}
