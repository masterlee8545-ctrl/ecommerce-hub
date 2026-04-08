/**
 * /sourcing/quotes/[id]/edit — 견적 편집 페이지 (F-6)
 *
 * 출처: F-6 (F-1 updateQuoteAction UI 진입점)
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 — 인증 강제 + RLS),
 *       §1 P-9 (사용자 친화 한국어), §1 P-2 (없는 견적 명시적 404)
 *
 * 역할:
 * - 기존 견적 단건을 로드해서 QuoteForm (mode=edit)에 주입
 * - updateQuoteAction을 quoteId로 bind해서 action prop으로 전달
 * - 확정(accepted) 견적은 경고 배너 + 편집 허용 (단, 폼 status 드롭다운엔 accepted 제외)
 * - 저장 성공 시 updateQuoteAction이 /products/[productId] 또는 /sourcing/quotes로 리다이렉트
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - getQuoteById가 withCompanyContext 안에서 조회 → 다른 회사 견적 0% 노출
 * - 존재하지 않으면 notFound() 호출 → Next.js 기본 404 페이지
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlertTriangle, ArrowLeft, Edit3 } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { listProducts } from '@/lib/products/queries';
import { updateQuoteAction } from '@/lib/sourcing/actions';
import { QUOTE_STATUS_META, type QuoteStatus } from '@/lib/sourcing/constants';
import { getQuoteById } from '@/lib/sourcing/quotes';
import { listSuppliers } from '@/lib/sourcing/suppliers';

import { QuoteForm, type QuoteFormDefaults } from '../../quote-form';

export const dynamic = 'force-dynamic';

const MAX_OPTIONS = 500;

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditQuotePage({ params }: PageProps) {
  const ctx = await requireCompanyContext();
  const { id } = await params;

  // 견적 단건 + 드롭다운용 상품/공급사를 병렬 조회
  const [quote, productsRaw, suppliersRaw] = await Promise.all([
    getQuoteById(ctx.companyId, id),
    listProducts({ companyId: ctx.companyId, limit: MAX_OPTIONS }),
    listSuppliers({ companyId: ctx.companyId, limit: MAX_OPTIONS }),
  ]);

  if (!quote) {
    notFound();
  }

  const productOptions = productsRaw.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));
  const supplierOptions = suppliersRaw.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // Quote → QuoteFormDefaults 매핑
  // decimal 컬럼은 string으로 오고, QuoteFormDefaults는 string도 허용
  const defaults: QuoteFormDefaults = {
    productId: quote.product_id,
    supplierId: quote.supplier_id,
    status: quote.status as QuoteStatus,
    unitPriceKrw: quote.unit_price_krw,
    unitPriceCny: quote.unit_price_cny,
    vatRate: quote.vat_rate,
    vatIncluded: quote.vat_included,
    moq: quote.moq,
    leadTimeDays: quote.lead_time_days,
    paymentTerms: quote.payment_terms,
    notes: quote.notes,
    specText: quote.spec_text,
  };

  // useActionState는 (state, form) => Promise<state> 형태만 받는다.
  // updateQuoteAction은 첫 인자가 quoteId이므로 bind로 사전 고정.
  const boundAction = updateQuoteAction.bind(null, quote.id);

  const isAccepted = quote.status === 'accepted';
  const statusMeta = QUOTE_STATUS_META[quote.status as QuoteStatus] ?? QUOTE_STATUS_META.requested;

  // 상품 이름은 표시용 (링크)
  const linkedProduct = productOptions.find((p) => p.id === quote.product_id) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href={linkedProduct ? `/products/${linkedProduct.id}` : '/sourcing/quotes'}
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {linkedProduct ? '상품 상세로' : '견적 목록으로'}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Edit3 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-navy-900">견적 수정</h1>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusMeta.bgColor} ${statusMeta.color}`}
              >
                {statusMeta.label}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-navy-500">
              {linkedProduct ? (
                <>
                  <span className="font-semibold">{linkedProduct.name}</span>{' '}
                  <span className="font-mono text-[11px] text-navy-400">({linkedProduct.code})</span>
                  {' 견적을 수정합니다.'}
                </>
              ) : (
                '상품 연결이 해제된 견적입니다. 상품을 다시 선택해주세요.'
              )}
            </p>
          </div>
        </div>
      </header>

      {/* 확정된 견적 경고 */}
      {isAccepted && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">이 견적은 이미 확정(accepted) 상태입니다.</div>
            <p className="mt-0.5">
              단가·메모·사양 등 부수 정보는 수정할 수 있지만, 상태를 직접{' '}
              <span className="font-semibold">accepted</span>로 되돌릴 수는 없습니다. 다른 견적을
              확정하려면{' '}
              {linkedProduct && (
                <Link
                  href={`/products/${linkedProduct.id}`}
                  className="font-semibold underline hover:text-amber-900"
                >
                  상품 상세 페이지의 견적 비교표
                </Link>
              )}
              에서 &ldquo;이 견적으로 발주&rdquo; 버튼을 사용하세요.
            </p>
          </div>
        </div>
      )}

      {/* 폼 */}
      <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        <QuoteForm
          action={boundAction}
          mode="edit"
          products={productOptions}
          suppliers={supplierOptions}
          defaultValues={defaults}
        />
      </div>

      {/* 메타 정보 (읽기 전용) */}
      <div className="rounded-md border border-navy-200 bg-navy-50/40 p-3 text-[11px] text-navy-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="font-semibold text-navy-600">의뢰일</span>{' '}
            {formatDate(quote.requested_at)}
          </span>
          {quote.received_at && (
            <span>
              <span className="font-semibold text-navy-600">수신일</span>{' '}
              {formatDate(quote.received_at)}
            </span>
          )}
          {quote.decided_at && (
            <span>
              <span className="font-semibold text-navy-600">결정일</span>{' '}
              {formatDate(quote.decided_at)}
            </span>
          )}
          {quote.source_file_name && (
            <span>
              <span className="font-semibold text-navy-600">출처 파일</span>{' '}
              {quote.source_file_name}
              {quote.source_row !== null && <span> (행 {quote.source_row})</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function formatDate(date: Date | null): string {
  if (!date) return '—';
  try {
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(date);
  }
}
