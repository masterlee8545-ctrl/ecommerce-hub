/**
 * /sourcing/quotes — 견적 전체 목록 페이지 (F-4)
 *
 * 출처: F-4 (F-1 + F-2 이후 축적된 견적 데이터 뷰)
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 안내), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 회사 전체 견적 목록 (최신순, 최대 100건)
 * - 상태 필터 (requested/received/accepted/rejected, 복수 선택 가능)
 * - 공급사 필터 (드롭다운)
 * - 각 행: 상품/공급사/단가(KRW + VAT포함 실효가)/MOQ/납기/상태/출처파일
 * - 빈 목록 안내 + "첫 견적 등록 / 엑셀 임포트" 두 진입점
 *
 * 쿼리 파라미터:
 * - ?status=received,requested  — 상태 필터
 * - ?supplierId=<uuid>           — 특정 공급사만
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제
 * - listQuotesWithRelations가 withCompanyContext로 RLS 적용
 */
import Link from 'next/link';

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CircleDollarSign,
  Edit3,
  FileSpreadsheet,
  Filter,
  Inbox,
  PackageSearch,
  Plus,
  ReceiptText,
  Upload,
} from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { updateQuoteStatusAction } from '@/lib/sourcing/actions';
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_META,
  toPriceWithVat,
  type QuoteStatus,
} from '@/lib/sourcing/constants';
import {
  listQuotesWithRelations,
  parseQuoteStatusFilter,
  type QuoteWithRelations,
} from '@/lib/sourcing/quotes';
import { listSuppliers } from '@/lib/sourcing/suppliers';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const LIST_LIMIT = 100;
const SUPPLIER_FILTER_LIMIT = 200;
const DEFAULT_VAT_FALLBACK = 0.1;
const QUOTE_ID_PREFIX_LENGTH = 8;

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    status?: string;
    supplierId?: string;
  }>;
}

export default async function QuotesListPage({ searchParams }: PageProps) {
  const ctx = await requireCompanyContext();
  const { status, supplierId } = await searchParams;

  const statusFilter = parseQuoteStatusFilter(status);

  // 병렬: 견적 목록 + 공급사 목록 (필터 드롭다운용)
  let rows: QuoteWithRelations[] = [];
  let dbError: string | null = null;
  let supplierOptions: Array<{ id: string; name: string }> = [];

  try {
    const [quoteRows, supplierRows] = await Promise.all([
      listQuotesWithRelations({
        companyId: ctx.companyId,
        limit: LIST_LIMIT,
        ...(statusFilter.length > 0 ? { statuses: statusFilter } : {}),
        ...(supplierId ? { supplierId } : {}),
      }),
      listSuppliers({ companyId: ctx.companyId, limit: SUPPLIER_FILTER_LIMIT }),
    ]);
    rows = quoteRows;
    supplierOptions = supplierRows.map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    console.error('[sourcing/quotes] listQuotesWithRelations 실패:', err);
    dbError =
      err instanceof Error
        ? `견적 목록 조회 중 오류: ${err.message}`
        : '견적 목록을 불러올 수 없습니다.';
  }

  const activeSupplier = supplierId
    ? supplierOptions.find((s) => s.id === supplierId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/sourcing"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
          소싱 개요로
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <ReceiptText className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-navy-900">견적 전체 목록</h1>
              <p className="mt-0.5 text-sm text-navy-500">
                수입 대행업체에서 받은 모든 견적을 한 눈에 확인하고 상태별로 필터링합니다.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sourcing/quotes/import"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              엑셀 임포트
            </Link>
            <Link
              href="/sourcing/quotes/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-700"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              견적 등록
            </Link>
          </div>
        </div>
      </header>

      {/* 필터 바 */}
      {!dbError && (
        <FilterBar
          activeStatuses={statusFilter}
          activeSupplier={activeSupplier}
          supplierOptions={supplierOptions}
        />
      )}

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel hasFilter={statusFilter.length > 0 || !!supplierId} />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
              견적 {rows.length.toLocaleString('ko-KR')}건
            </h2>
            <span className="text-[11px] text-navy-400">
              최신 순 · 최대 {LIST_LIMIT.toLocaleString('ko-KR')}건
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-navy-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-navy-50 text-[11px] font-semibold uppercase tracking-wide text-navy-600">
                <tr>
                  <th className="px-3 py-2 text-left">상품</th>
                  <th className="px-3 py-2 text-left">공급사</th>
                  <th className="px-3 py-2 text-right">단가 (KRW)</th>
                  <th className="px-3 py-2 text-right">실효가 (VAT포함)</th>
                  <th className="px-3 py-2 text-right">MOQ</th>
                  <th className="px-3 py-2 text-right">납기</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">수신일</th>
                  <th className="px-3 py-2 text-right"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {rows.map((r) => (
                  <QuoteRow key={r.quote.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 필터 바 (GET form — 서버 컴포넌트에서 동작)
// ─────────────────────────────────────────────────────────

interface FilterBarProps {
  activeStatuses: QuoteStatus[];
  activeSupplier: { id: string; name: string } | null;
  supplierOptions: Array<{ id: string; name: string }>;
}

function FilterBar({ activeStatuses, activeSupplier, supplierOptions }: FilterBarProps) {
  const activeSet = new Set(activeStatuses);

  return (
    <section className="rounded-lg border border-navy-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-500">
        <Filter className="h-3 w-3" aria-hidden />
        필터
      </div>

      {/* 상태 토글 칩 (링크 — JS 불필요) */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip
          label="전체"
          href={buildHref({ status: null, supplierId: activeSupplier?.id ?? null })}
          active={activeStatuses.length === 0}
        />
        {QUOTE_STATUSES.map((s) => {
          const isActive = activeSet.has(s);
          const next = toggleStatus(activeStatuses, s);
          return (
            <StatusChip
              key={s}
              label={QUOTE_STATUS_META[s].label}
              href={buildHref({
                status: next.length > 0 ? next.join(',') : null,
                supplierId: activeSupplier?.id ?? null,
              })}
              active={isActive}
              tone={s}
            />
          );
        })}
      </div>

      {/* 공급사 드롭다운 (GET form) */}
      {supplierOptions.length > 0 && (
        <form
          method="get"
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3"
        >
          {/* 현재 status 필터를 유지 */}
          {activeStatuses.length > 0 && (
            <input type="hidden" name="status" value={activeStatuses.join(',')} />
          )}
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-navy-600">
            <Building2 className="h-3 w-3 text-navy-400" aria-hidden />
            공급사
          </label>
          <select
            name="supplierId"
            defaultValue={activeSupplier?.id ?? ''}
            className="min-w-[200px] rounded-md border border-navy-200 bg-white px-2 py-1 text-xs text-navy-700 focus:border-teal-400 focus:outline-none"
          >
            <option value="">전체 ({supplierOptions.length.toLocaleString('ko-KR')}곳)</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-teal-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-teal-700"
          >
            적용
          </button>
          {activeSupplier && (
            <Link
              href={buildHref({
                status: activeStatuses.length > 0 ? activeStatuses.join(',') : null,
                supplierId: null,
              })}
              className="text-[11px] font-semibold text-navy-500 underline hover:text-teal-700"
            >
              초기화
            </Link>
          )}
        </form>
      )}
    </section>
  );
}

// 상태 칩 하나
interface StatusChipProps {
  label: string;
  href: string;
  active: boolean;
  tone?: QuoteStatus;
}

function StatusChip({ label, href, active, tone }: StatusChipProps) {
  const toneClass =
    tone && active
      ? `${QUOTE_STATUS_META[tone].bgColor} ${QUOTE_STATUS_META[tone].color} ring-1 ring-inset ring-current/20`
      : active
        ? 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
        : 'bg-navy-50 text-navy-600 ring-1 ring-inset ring-navy-200 hover:bg-navy-100';
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${toneClass}`}
    >
      {label}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 행
// ─────────────────────────────────────────────────────────

interface QuoteRowProps {
  row: QuoteWithRelations;
}

function QuoteRow({ row }: QuoteRowProps) {
  const { quote: q, product, supplier } = row;
  const meta = QUOTE_STATUS_META[q.status as QuoteStatus] ?? QUOTE_STATUS_META.requested;

  const unitPrice = q.unit_price_krw !== null ? Number(q.unit_price_krw) : null;
  const vatRate =
    q.vat_rate !== null && q.vat_rate !== undefined ? Number(q.vat_rate) : DEFAULT_VAT_FALLBACK;
  const effectivePrice = unitPrice !== null ? toPriceWithVat(unitPrice, vatRate, q.vat_included) : null;

  return (
    <tr className="transition hover:bg-navy-50/40">
      {/* 상품 */}
      <td className="px-3 py-2 align-top">
        {product ? (
          <Link
            href={`/products/${product.id}`}
            className="group inline-flex min-w-0 items-center gap-1.5"
          >
            <PackageSearch className="h-3 w-3 shrink-0 text-navy-400" aria-hidden />
            <span className="min-w-0 truncate font-semibold text-navy-800 group-hover:text-teal-700">
              {product.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-navy-400">{product.code}</span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            상품 연결 없음
          </span>
        )}
      </td>

      {/* 공급사 */}
      <td className="px-3 py-2 align-top">
        {supplier ? (
          <Link
            href={`/sourcing/suppliers/${supplier.id}`}
            className="inline-flex min-w-0 items-center gap-1 truncate text-navy-700 hover:text-teal-700"
          >
            <Building2 className="h-3 w-3 shrink-0 text-navy-400" aria-hidden />
            <span className="truncate">{supplier.name}</span>
          </Link>
        ) : (
          <span className="text-[11px] text-navy-400">—</span>
        )}
      </td>

      {/* 단가 (원화) */}
      <td className="px-3 py-2 text-right align-top font-mono">
        {unitPrice !== null ? (
          <span className="text-navy-800">{unitPrice.toLocaleString('ko-KR')}원</span>
        ) : (
          <span className="text-navy-400">—</span>
        )}
      </td>

      {/* 실효가 (VAT 포함) */}
      <td className="px-3 py-2 text-right align-top font-mono">
        {effectivePrice !== null ? (
          <div className="flex flex-col items-end">
            <span className="font-semibold text-emerald-700">
              {Math.round(effectivePrice).toLocaleString('ko-KR')}원
            </span>
            <span className="text-[10px] text-navy-400">
              {q.vat_included ? 'VAT 포함가' : `VAT ${(vatRate * 100).toFixed(0)}% 별도`}
            </span>
          </div>
        ) : (
          <span className="text-navy-400">—</span>
        )}
      </td>

      {/* MOQ */}
      <td className="px-3 py-2 text-right align-top font-mono text-navy-600">
        {q.moq !== null ? q.moq.toLocaleString('ko-KR') : '—'}
      </td>

      {/* 납기 */}
      <td className="px-3 py-2 text-right align-top font-mono text-navy-600">
        {q.lead_time_days !== null ? `${q.lead_time_days}일` : '—'}
      </td>

      {/* 상태 */}
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.bgColor} ${meta.color}`}
        >
          {meta.label}
        </span>
      </td>

      {/* 수신일 + 출처 */}
      <td className="px-3 py-2 align-top text-[11px] text-navy-500">
        <div>{formatDate(q.received_at ?? q.requested_at)}</div>
        {q.source_file_name && (
          <div className="mt-0.5 flex items-center gap-0.5 text-[10px] text-navy-400">
            <FileSpreadsheet className="h-2.5 w-2.5" aria-hidden />
            <span className="truncate">{q.source_file_name}</span>
          </div>
        )}
      </td>

      {/* 작업 — 상태 전환(G-3a) + 수정 링크 */}
      <td className="px-3 py-2 text-right align-top">
        <div className="flex flex-col items-end gap-1">
          {q.status === 'requested' && (
            <form action={updateQuoteStatusAction}>
              <input type="hidden" name="quoteId" value={q.id} />
              <input type="hidden" name="status" value="received" />
              {q.product_id && (
                <input type="hidden" name="productId" value={q.product_id} />
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 transition hover:bg-teal-100"
                title="공급사에서 견적서를 받았음을 표시합니다 (수신일이 지금으로 기록됩니다)."
                aria-label={`견적 ${q.id.slice(0, QUOTE_ID_PREFIX_LENGTH)} 수신 처리`}
              >
                <Inbox className="h-3 w-3" aria-hidden />
                수신
              </button>
            </form>
          )}
          <Link
            href={`/sourcing/quotes/${q.id}/edit`}
            className="inline-flex items-center gap-1 rounded border border-navy-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-navy-600 transition hover:border-teal-300 hover:text-teal-700"
            aria-label={`견적 ${q.id.slice(0, QUOTE_ID_PREFIX_LENGTH)} 수정`}
          >
            <Edit3 className="h-3 w-3" aria-hidden />
            수정
          </Link>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel({ hasFilter }: { hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
        <Filter className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
        <h2 className="mt-3 text-base font-semibold text-navy-700">
          필터 조건에 맞는 견적이 없습니다
        </h2>
        <p className="mt-1 text-xs text-navy-500">
          다른 상태나 공급사를 선택하거나{' '}
          <Link href="/sourcing/quotes" className="font-semibold text-teal-700 underline">
            필터를 초기화
          </Link>
          하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <CircleDollarSign className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">
        아직 등록된 견적이 없습니다
      </h2>
      <p className="mt-1 text-xs text-navy-500">
        수입 대행업체에게 받은 견적을 한 건씩 등록하거나, 엑셀 파일로 한 번에 올릴 수 있습니다.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Link
          href="/sourcing/quotes/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />첫 견적 등록
        </Link>
        <Link
          href="/sourcing/quotes/import"
          className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-4 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          엑셀 일괄 임포트
        </Link>
      </div>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">견적 목록을 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결 또는 마이그레이션 적용을 확인하세요. (<code>npm run db:push</code>)
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// URL 헬퍼
// ─────────────────────────────────────────────────────────

/** 상태 토글 — 이미 있으면 제거, 없으면 추가 */
function toggleStatus(current: QuoteStatus[], target: QuoteStatus): QuoteStatus[] {
  if (current.includes(target)) {
    return current.filter((s) => s !== target);
  }
  return [...current, target];
}

/** 필터 URL 생성 — 값이 null이면 해당 파라미터 제거 */
function buildHref(params: { status: string | null; supplierId: string | null }): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.supplierId) qs.set('supplierId', params.supplierId);
  const str = qs.toString();
  return str.length > 0 ? `/sourcing/quotes?${str}` : '/sourcing/quotes';
}

// ─────────────────────────────────────────────────────────
// 날짜 포맷
// ─────────────────────────────────────────────────────────

function formatDate(date: Date | null): string {
  if (!date) return '—';
  try {
    return date.toLocaleDateString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(date);
  }
}
