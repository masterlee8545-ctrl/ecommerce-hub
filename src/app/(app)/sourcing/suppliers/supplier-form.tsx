/**
 * 공급사 폼 — 신규 등록 / 수정 공용 클라이언트 컴포넌트
 *
 * 출처: D-2c (공급사 상세 + 생성 페이지)
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어), §1 P-2 (실패 시 명시 표시),
 *       §1 P-4 (멀티테넌트 — companyId는 폼에 없음)
 *
 * 역할:
 * - useActionState로 Server Action 호출
 * - 필드별 에러 메시지 인라인 표시 + 전역 에러 패널
 * - 제출 중 disabled 상태 + 스피너
 *
 * 사용법 (신규):
 * ```tsx
 * <SupplierForm action={createSupplierAction} mode="create" />
 * ```
 *
 * 사용법 (수정):
 * ```tsx
 * <SupplierForm
 *   action={updateSupplierAction.bind(null, supplier.id)}
 *   mode="edit"
 *   defaultValues={supplier}
 * />
 * ```
 */
'use client';

import { useActionState } from 'react';

import { AlertCircle, Loader2, Save } from 'lucide-react';

import {
  SUPPLIER_INITIAL_STATE,
  type SupplierActionState,
} from '@/lib/sourcing/action-types';
import { SUPPLIER_SOURCES, type SupplierSource } from '@/lib/sourcing/constants';

const MAX_RATING = 5;
const RATING_OPTIONS = Array.from({ length: MAX_RATING }, (_, i) => i + 1);

// ─────────────────────────────────────────────────────────
// 출처 옵션 메타
// ─────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<SupplierSource, string> = {
  '1688': '1688 (알리바바 도매)',
  taobao: '타오바오',
  domestic: '국내 도매',
  other: '기타',
};

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

export interface SupplierFormDefaults {
  name?: string;
  source?: SupplierSource;
  source_url?: string | null;
  contact_info?: string | null;
  rating?: number | null;
  notes?: string | null;
}

interface SupplierFormProps {
  action: (
    state: SupplierActionState,
    form: FormData,
  ) => Promise<SupplierActionState>;
  mode: 'create' | 'edit';
  defaultValues?: SupplierFormDefaults;
}

// ─────────────────────────────────────────────────────────
// 폼
// ─────────────────────────────────────────────────────────

export function SupplierForm({ action, mode, defaultValues }: SupplierFormProps) {
  const [state, formAction, pending] = useActionState(action, SUPPLIER_INITIAL_STATE);

  const isEdit = mode === 'edit';
  const submitLabel = isEdit ? '저장하기' : '공급사 등록';

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

      {/* 공급사 이름 */}
      <Field
        label="공급사 이름"
        required
        hint="예: 杭州XX贸易有限公司, 의류 도매 ABC"
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

      {/* 출처 */}
      <Field
        label="출처"
        required
        hint="공급사가 어떤 플랫폼에서 왔는지 선택하세요."
        error={state.fieldErrors?.source}
      >
        <select
          name="source"
          defaultValue={defaultValues?.source ?? ''}
          required
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        >
          <option value="" disabled>
            -- 출처를 선택하세요 --
          </option>
          {SUPPLIER_SOURCES.map((src) => (
            <option key={src} value={src}>
              {SOURCE_LABEL[src]}
            </option>
          ))}
        </select>
      </Field>

      {/* 출처 URL */}
      <Field
        label="출처 URL"
        hint="(선택) 1688 / 타오바오 매장 페이지 주소"
        error={state.fieldErrors?.sourceUrl}
      >
        <input
          name="sourceUrl"
          type="url"
          defaultValue={defaultValues?.source_url ?? ''}
          placeholder="https://..."
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 연락처 */}
      <Field
        label="연락처"
        hint="(선택) 위챗 ID / 이메일 / 전화번호 — 메모해두세요."
      >
        <input
          name="contactInfo"
          type="text"
          defaultValue={defaultValues?.contact_info ?? ''}
          className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </Field>

      {/* 평점 */}
      <Field
        label="평점"
        hint="(선택) 1~5점 사이로 평가하세요. 나중에 수정 가능합니다."
        error={state.fieldErrors?.rating}
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            name="rating"
            defaultValue={defaultValues?.rating?.toString() ?? ''}
            className="rounded-md border border-navy-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="">평가 안 함</option>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)} ({r}점)
              </option>
            ))}
          </select>
        </div>
      </Field>

      {/* 메모 */}
      <Field
        label="메모"
        hint="(선택) 강점/단점/주의사항을 자유롭게 적어두세요."
      >
        <textarea
          name="notes"
          defaultValue={defaultValues?.notes ?? ''}
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
