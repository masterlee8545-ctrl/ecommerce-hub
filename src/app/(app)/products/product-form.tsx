/**
 * 상품 폼 — 신규 등록 / 수정 공용 클라이언트 컴포넌트
 *
 * 출처: E-1d (신규 등록), E-1e (상세 수정)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어), §1 P-2 (실패 시 명시 표시),
 *       §1 P-3 (cogs/margin은 estimated 강제 — DB가 자동으로 마킹)
 *
 * 역할:
 * - useActionState로 createProductAction / updateProductAction 호출
 * - 필드별 에러 메시지 인라인 표시 + 전역 에러 패널
 * - 제출 중 disabled + 스피너
 * - 신뢰도 셀렉트 (confirmed/estimated/unknown) — 선택 안 하면 DB에서 자동 estimated
 *
 * 사용법 (신규):
 * ```tsx
 * <ProductForm action={createProductAction} mode="create" suggestedCode="PROD-2026-0042" />
 * ```
 *
 * 사용법 (수정):
 * ```tsx
 * <ProductForm
 *   action={updateProductAction.bind(null, product.id)}
 *   mode="edit"
 *   defaultValues={product}
 * />
 * ```
 *
 * 마진율 표기:
 * - 사용자에게는 퍼센트(%) 단위로 노출 — '40' 입력 → DB는 0.4 저장
 * - actions.ts의 parseMarginRateField가 자동으로 100으로 나눔
 */
'use client';

import { useActionState } from 'react';

import { AlertCircle, Loader2, Save } from 'lucide-react';

import {
  PRODUCT_INITIAL_STATE,
  type ProductActionState,
} from '@/lib/products/action-types';
import {
  CONFIDENCE_LEVELS,
  CONFIDENCE_META,
  type ConfidenceLevel,
} from '@/lib/products/constants';

const PERCENT_MULTIPLIER = 100;
const MARGIN_DECIMALS = 1;

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

export interface ProductFormDefaults {
  code?: string;
  name?: string;
  category?: string | null;
  description?: string | null;
  cogs_cny?: string | null; //                       drizzle decimal은 string
  cogs_cny_confidence?: string | null;
  selling_price_krw?: string | null;
  margin_rate?: string | null;
  margin_rate_confidence?: string | null;
}

interface ProductFormProps {
  action: (
    state: ProductActionState,
    form: FormData,
  ) => Promise<ProductActionState>;
  mode: 'create' | 'edit';
  defaultValues?: ProductFormDefaults;
  /** 신규 등록 모드에서만 사용: 자동 추천 코드 */
  suggestedCode?: string;
}

// ─────────────────────────────────────────────────────────
// 폼
// ─────────────────────────────────────────────────────────

export function ProductForm({ action, mode, defaultValues, suggestedCode }: ProductFormProps) {
  const [state, formAction, pending] = useActionState(action, PRODUCT_INITIAL_STATE);

  const isEdit = mode === 'edit';
  const submitLabel = isEdit ? '저장하기' : '상품 등록';

  // 마진율 default — DB는 0~1 (예: 0.4178), 사용자에겐 % (예: 41.78)
  const marginPercentDefault =
    defaultValues?.margin_rate != null
      ? (Number(defaultValues.margin_rate) * PERCENT_MULTIPLIER).toFixed(MARGIN_DECIMALS)
      : '';

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

      {/* 상품 코드 (신규에서만) */}
      {!isEdit && (
        <Field
          label="상품 코드"
          required
          hint="회사 내에서 고유한 코드 (예: PROD-2026-0042). 자동 추천된 값 그대로 두셔도 됩니다."
          error={state.fieldErrors?.code}
        >
          <input
            name="code"
            type="text"
            defaultValue={suggestedCode ?? defaultValues?.code ?? ''}
            required
            maxLength={50}
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 font-mono text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </Field>
      )}

      {/* 상품 이름 */}
      <Field
        label="상품 이름"
        required
        hint="예: '수입 마늘 다지기 1L', '농산물 보관용 진공팩 100매'"
        error={state.fieldErrors?.name}
      >
        <input
          name="name"
          type="text"
          defaultValue={defaultValues?.name ?? ''}
          required
          maxLength={200}
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 카테고리 */}
      <Field
        label="카테고리"
        hint="(선택) 예: '주방용품', '농산물', '생활용품'"
        error={state.fieldErrors?.category}
      >
        <input
          name="category"
          type="text"
          defaultValue={defaultValues?.category ?? ''}
          maxLength={100}
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* ─── 가격 정보 (P-3 강제) ─── */}
      <div className="rounded-md border border-yellow-200 bg-yellow-50/50 p-4">
        <div className="mb-3 flex items-start gap-2 text-xs text-yellow-800">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <div>
            <span className="font-semibold">가격 정보는 모두 추정값입니다 (P-3).</span> 회계
            처리에 직접 사용 금지. 신뢰도를 명시하지 않으면 자동으로 &quot;추정&quot;이 적용됩니다.
          </div>
        </div>

        {/* 원가 (위안) */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label="원가 (위안 ¥)"
            hint="공급사 견적 또는 1688 페이지의 단가"
            error={state.fieldErrors?.cogsCny}
          >
            <input
              name="cogsCny"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaultValues?.cogs_cny ?? ''}
              className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </Field>
          <Field label="원가 신뢰도" hint="원가 출처의 확실성">
            <ConfidenceSelect
              name="cogsCnyConfidence"
              defaultValue={defaultValues?.cogs_cny_confidence ?? ''}
            />
          </Field>
        </div>

        {/* 판매가 (원) */}
        <div className="mt-3">
          <Field
            label="예상 판매가 (원 ₩)"
            hint="쿠팡/네이버에 등록 예정인 가격 (추정)"
            error={state.fieldErrors?.sellingPriceKrw}
          >
            <input
              name="sellingPriceKrw"
              type="number"
              step="1"
              min="0"
              defaultValue={defaultValues?.selling_price_krw ?? ''}
              className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </Field>
        </div>

        {/* 마진률 */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label="예상 마진률 (%)"
            hint="순이익 / 판매가. 예: 35 입력 → 35%"
            error={state.fieldErrors?.marginRate}
          >
            <input
              name="marginRate"
              type="number"
              step="0.1"
              defaultValue={marginPercentDefault}
              className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </Field>
          <Field label="마진률 신뢰도" hint="견적이 확정됐나요?">
            <ConfidenceSelect
              name="marginRateConfidence"
              defaultValue={defaultValues?.margin_rate_confidence ?? ''}
            />
          </Field>
        </div>
      </div>

      {/* 설명 */}
      <Field
        label="상품 설명"
        hint="(선택) 상세페이지 작성 전 메모해둘 특징"
        error={state.fieldErrors?.description}
      >
        <textarea
          name="description"
          defaultValue={defaultValues?.description ?? ''}
          rows={4}
          className="w-full resize-none rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 제출 버튼 */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
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
// 신뢰도 셀렉트
// ─────────────────────────────────────────────────────────

interface ConfidenceSelectProps {
  name: string;
  defaultValue: string;
}

function ConfidenceSelect({ name, defaultValue }: ConfidenceSelectProps) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
    >
      <option value="">자동 (값이 있으면 추정)</option>
      {CONFIDENCE_LEVELS.map((level) => (
        <option key={level} value={level}>
          {CONFIDENCE_META[level as ConfidenceLevel].label}
        </option>
      ))}
    </select>
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
