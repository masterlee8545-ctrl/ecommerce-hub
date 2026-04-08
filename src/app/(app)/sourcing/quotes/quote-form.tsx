/**
 * 견적 폼 — 신규 등록 / 수정 공용 클라이언트 컴포넌트
 *
 * 출처: F-1d (견적 단건 수동 입력 페이지)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어), §1 P-2 (실패 시 명시 표시),
 *       §1 P-4 (멀티테넌트 — companyId는 폼에 없음)
 *
 * 역할:
 * - useActionState로 Server Action 호출
 * - 상품/공급사 선택 (드롭다운)
 * - 단가 (원화/위안) + VAT 정보 + MOQ / 납기 / 결제조건
 * - 필드별 에러 메시지 인라인 표시
 * - 제출 중 disabled 상태 + 스피너
 *
 * 사용법 (신규):
 * ```tsx
 * <QuoteForm
 *   action={createQuoteAction}
 *   mode="create"
 *   products={productOptions}
 *   suppliers={supplierOptions}
 * />
 * ```
 */
'use client';

import { useActionState } from 'react';

import Link from 'next/link';

import { AlertCircle, Loader2, Save } from 'lucide-react';

import {
  QUOTE_INITIAL_STATE,
  type QuoteActionState,
} from '@/lib/sourcing/action-types';
import {
  DEFAULT_VAT_RATE,
  QUOTE_STATUS_META,
  QUOTE_STATUSES,
  type QuoteStatus,
} from '@/lib/sourcing/constants';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const PERCENT_MULTIPLIER = 100;
const DEFAULT_VAT_PERCENT = DEFAULT_VAT_RATE * PERCENT_MULTIPLIER;

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

export interface QuoteFormProductOption {
  id: string;
  code: string;
  name: string;
}

export interface QuoteFormSupplierOption {
  id: string;
  name: string;
}

export interface QuoteFormDefaults {
  productId?: string | null;
  supplierId?: string | null;
  status?: QuoteStatus;
  unitPriceKrw?: number | string | null;
  unitPriceCny?: number | string | null;
  vatRate?: number | string | null;
  vatIncluded?: boolean;
  moq?: number | null;
  leadTimeDays?: number | null;
  paymentTerms?: string | null;
  notes?: string | null;
  specText?: string | null;
}

interface QuoteFormProps {
  action: (
    state: QuoteActionState,
    form: FormData,
  ) => Promise<QuoteActionState>;
  mode: 'create' | 'edit';
  products: QuoteFormProductOption[];
  suppliers: QuoteFormSupplierOption[];
  defaultValues?: QuoteFormDefaults;
  /** 특정 상품 고정 (상품 상세 페이지에서 호출 시) */
  lockedProductId?: string;
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

function numberOrEmpty(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** vat_rate (0~1) → 퍼센트 문자열 */
function vatRateToPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return String(DEFAULT_VAT_PERCENT);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(DEFAULT_VAT_PERCENT);
  return String(num * PERCENT_MULTIPLIER);
}

// ─────────────────────────────────────────────────────────
// 폼
// ─────────────────────────────────────────────────────────

export function QuoteForm({
  action,
  mode,
  products,
  suppliers,
  defaultValues,
  lockedProductId,
}: QuoteFormProps) {
  const [state, formAction, pending] = useActionState(action, QUOTE_INITIAL_STATE);

  const isEdit = mode === 'edit';
  const submitLabel = isEdit ? '저장하기' : '견적 등록';

  const effectiveProductId = lockedProductId ?? defaultValues?.productId ?? '';

  return (
    <form action={formAction} className="space-y-5">
      {/* 전역 에러 패널 */}
      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">{state.error}</div>
            {state.fieldErrors && (
              <div className="mt-1 text-xs text-red-600">아래 항목을 확인해주세요.</div>
            )}
          </div>
        </div>
      )}

      {/* 상품 선택 */}
      <Field
        label="상품"
        required
        hint="이 견적이 어느 상품에 대한 것인지 선택하세요."
        error={state.fieldErrors?.productId}
      >
        {lockedProductId ? (
          <>
            <input type="hidden" name="productId" value={lockedProductId} />
            <div className="rounded-md border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
              {products.find((p) => p.id === lockedProductId)?.name ?? '(상품 정보 없음)'}
              {products.find((p) => p.id === lockedProductId)?.code && (
                <span className="ml-2 font-mono text-[11px] text-navy-500">
                  {products.find((p) => p.id === lockedProductId)?.code}
                </span>
              )}
            </div>
          </>
        ) : (
          <select
            name="productId"
            defaultValue={effectiveProductId}
            required
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="" disabled>
              -- 상품을 선택하세요 --
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.code}] {p.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* 공급사 선택 */}
      <Field
        label="공급사 (수입 대행업체)"
        required
        hint="견적을 보내온 업체를 선택하세요. 아직 등록하지 않았다면 먼저 공급사를 등록해야 합니다."
        error={state.fieldErrors?.supplierId}
      >
        {suppliers.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            등록된 공급사가 없습니다.{' '}
            <Link
              href="/sourcing/suppliers/new"
              className="font-semibold underline hover:text-amber-900"
            >
              먼저 공급사를 등록해주세요
            </Link>
            .
          </div>
        ) : (
          <select
            name="supplierId"
            defaultValue={defaultValues?.supplierId ?? ''}
            required
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="" disabled>
              -- 공급사를 선택하세요 --
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* 단가 (원화) — 주력 */}
      <Field
        label="공급단가 (원화, ₩)"
        required
        hint="수입 대행업체가 제시한 원화 단가. 부가세는 아래에서 별도 표시하세요."
        error={state.fieldErrors?.unitPriceKrw}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy-500">₩</span>
          <input
            name="unitPriceKrw"
            type="number"
            step="0.01"
            min="0"
            defaultValue={numberOrEmpty(defaultValues?.unitPriceKrw)}
            placeholder="예: 3500"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>
      </Field>

      {/* 단가 (위안) — 선택 */}
      <Field
        label="공급단가 (위안, ¥)"
        hint="(선택) 중국 직거래 대비용. 대행업체 거래만 한다면 비워도 됩니다."
        error={state.fieldErrors?.unitPriceCny}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy-500">¥</span>
          <input
            name="unitPriceCny"
            type="number"
            step="0.01"
            min="0"
            defaultValue={numberOrEmpty(defaultValues?.unitPriceCny)}
            placeholder="예: 18.50"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>
      </Field>

      {/* VAT 정보 */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field
          label="부가세율 (%)"
          hint="기본 10%. 대부분의 수입품은 10%입니다."
          error={state.fieldErrors?.vatRate}
        >
          <div className="flex items-center gap-2">
            <input
              name="vatRate"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={vatRateToPercent(defaultValues?.vatRate)}
              className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <span className="text-sm font-semibold text-navy-500">%</span>
          </div>
        </Field>

        <Field label="VAT 포함 여부" hint="견적서가 VAT 별도 표시면 체크 해제 (기본).">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm">
            <input
              name="vatIncluded"
              type="checkbox"
              defaultChecked={defaultValues?.vatIncluded ?? false}
              className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-400"
            />
            <span>이미 VAT가 단가에 포함되어 있음</span>
          </label>
        </Field>
      </div>

      {/* MOQ + 납기 */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field
          label="최소 주문수량 (MOQ)"
          hint="(선택) 공급사가 요구하는 최소 수량."
          error={state.fieldErrors?.moq}
        >
          <input
            name="moq"
            type="number"
            min="1"
            step="1"
            defaultValue={numberOrEmpty(defaultValues?.moq)}
            placeholder="예: 100"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </Field>

        <Field
          label="납기 일수 (일)"
          hint="(선택) 발주 후 제품 수령까지 걸리는 일수."
          error={state.fieldErrors?.leadTimeDays}
        >
          <input
            name="leadTimeDays"
            type="number"
            min="0"
            step="1"
            defaultValue={numberOrEmpty(defaultValues?.leadTimeDays)}
            placeholder="예: 30"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </Field>
      </div>

      {/* 결제조건 */}
      <Field
        label="결제 조건"
        hint='(선택) 예: "선금 30%, 잔금 70%", "전액 후불" 등'
        error={state.fieldErrors?.paymentTerms}
      >
        <input
          name="paymentTerms"
          type="text"
          defaultValue={defaultValues?.paymentTerms ?? ''}
          placeholder="예: 선금 30% / 잔금 70%"
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 사양 설명 */}
      <Field
        label="사양 설명"
        hint="(선택) 견적서의 사양 / 스펙 / 옵션 설명을 메모해두세요."
        error={state.fieldErrors?.specText}
      >
        <textarea
          name="specText"
          defaultValue={defaultValues?.specText ?? ''}
          rows={3}
          placeholder="예: 스텐 304, 손잡이 포함, 색상 블랙"
          className="w-full resize-none rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 메모 */}
      <Field
        label="메모"
        hint="(선택) 이 견적에 대한 자유 메모."
        error={state.fieldErrors?.notes}
      >
        <textarea
          name="notes"
          defaultValue={defaultValues?.notes ?? ''}
          rows={3}
          placeholder="예: 담당자와 재협상 여지 있음"
          className="w-full resize-none rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 상태 — 편집 모드에서만 노출 */}
      {isEdit && (
        <Field label="상태" hint="확정(accepted)은 별도 '이 견적으로 발주' 버튼을 사용하세요.">
          <select
            name="status"
            defaultValue={defaultValues?.status ?? 'received'}
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          >
            {QUOTE_STATUSES.filter((s) => s !== 'accepted').map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* 제출 버튼 */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending || suppliers.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              저장 중...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" aria-hidden />
              {submitLabel}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────
// 필드 래퍼
// ─────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}

function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-navy-800">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {hint && <p className="mt-0.5 text-[11px] text-navy-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
