/**
 * /sourcing/quotes/new — 새 견적 등록 페이지 (단건 수동 입력)
 *
 * 출처: F-1d
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 — 인증 강제), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 인증된 사용자에게 견적 등록 폼 제공
 * - 회사의 모든 상품 + 공급사 목록을 드롭다운 옵션으로 전달
 * - QuoteForm + createQuoteAction 조합
 * - 쿼리 파라미터 ?productId=... 로 특정 상품을 기본 선택 가능 (상품 상세 → 견적 등록 시)
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제 → 미인증 시 자동 /login
 * - companyId는 폼에 노출하지 않음 (Server Action이 세션에서 직접 추출)
 */
import Link from 'next/link';

import { ArrowLeft, ReceiptText } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { listProducts } from '@/lib/products/queries';
import { createQuoteAction } from '@/lib/sourcing/actions';
import { listSuppliers } from '@/lib/sourcing/suppliers';

import { QuoteForm, type QuoteFormDefaults } from '../quote-form';

export const dynamic = 'force-dynamic';

const MAX_OPTIONS = 500;

interface PageProps {
  searchParams: Promise<{ productId?: string }>;
}

export default async function NewQuotePage({ searchParams }: PageProps) {
  const ctx = await requireCompanyContext();
  const { productId } = await searchParams;

  // 드롭다운용 데이터 병렬 로드
  const [productsRaw, suppliersRaw] = await Promise.all([
    listProducts({ companyId: ctx.companyId, limit: MAX_OPTIONS }),
    listSuppliers({ companyId: ctx.companyId, limit: MAX_OPTIONS }),
  ]);

  const productOptions = productsRaw.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));
  const supplierOptions = suppliersRaw.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // 쿼리 파라미터로 특정 상품이 지정되었는지 확인
  const lockedProductId =
    productId && productOptions.some((p) => p.id === productId) ? productId : undefined;

  const defaults: QuoteFormDefaults = {
    productId: lockedProductId ?? null,
    supplierId: null,
    status: 'received',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href={lockedProductId ? `/products/${lockedProductId}` : '/sourcing/quotes'}
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {lockedProductId ? '상품 상세로' : '견적 목록으로'}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <ReceiptText className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-900">새 견적 등록</h1>
            <p className="mt-0.5 text-sm text-navy-500">
              수입 대행업체에게 받은 견적을 수동으로 등록합니다. 한 번에 여러 건을 등록하려면{' '}
              <Link
                href="/sourcing/quotes/import"
                className="font-semibold text-teal-700 underline hover:text-teal-900"
              >
                엑셀 일괄 임포트
              </Link>
              를 이용하세요.
            </p>
          </div>
        </div>
      </header>

      {/* 폼 카드 */}
      <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        {productOptions.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold">등록된 상품이 없습니다.</p>
            <p className="mt-1 text-xs">
              견적을 등록하려면 먼저 상품을 추가해야 합니다.{' '}
              <Link
                href="/products/new"
                className="font-semibold underline hover:text-amber-900"
              >
                상품 등록하기
              </Link>
            </p>
          </div>
        ) : (
          <QuoteForm
            action={createQuoteAction}
            mode="create"
            products={productOptions}
            suppliers={supplierOptions}
            defaultValues={defaults}
            {...(lockedProductId !== undefined ? { lockedProductId } : {})}
          />
        )}
      </div>

      {/* 안내 */}
      <div className="rounded-md border border-navy-200 bg-navy-50/40 p-3 text-[11px] text-navy-500">
        💡 등록 후 상품 상세 페이지의 &ldquo;견적 비교표&rdquo;에서 이 견적을 확인할 수 있습니다.
        가장 유리한 견적을 골라 &ldquo;이 견적으로 발주&rdquo; 버튼을 누르면 상품이 자동으로 수입
        단계로 넘어갑니다.
      </div>
    </div>
  );
}
