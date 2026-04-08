/**
 * 견적 엑셀 벌크 임포트 폼 — 클라이언트 컴포넌트 (F-2d)
 *
 * 출처: F-2 엑셀 일괄 임포트
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어 메시지), §1 P-1 (빈 결과 은폐 금지),
 *       §1 P-2 (실패 시 명시 표시)
 *
 * 역할:
 * - 파일 업로드 (input type=file, accept=.xlsx)
 * - useActionState로 bulkImportQuotesAction 호출
 * - 결과 요약 표시 (성공/미매칭/실패 행별 상태 + 메시지)
 * - 미매칭 행은 상품/공급사를 추가 등록하고 재임포트하도록 안내
 */
'use client';

import { useActionState } from 'react';

import Link from 'next/link';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';

import {
  QUOTE_IMPORT_INITIAL_STATE,
  type QuoteImportActionState,
  type QuoteImportRowSummary,
} from '@/lib/sourcing/action-types';

interface ImportFormProps {
  action: (
    state: QuoteImportActionState,
    form: FormData,
  ) => Promise<QuoteImportActionState>;
}

export function ImportForm({ action }: ImportFormProps) {
  const [state, formAction, pending] = useActionState(action, QUOTE_IMPORT_INITIAL_STATE);

  return (
    <div className="space-y-6">
      {/* 업로드 카드 */}
      <form action={formAction} className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-800">
          <Upload className="h-4 w-4 text-teal-600" aria-hidden />
          엑셀 파일 업로드
        </h2>
        <p className="mt-1 text-xs text-navy-500">
          .xlsx 파일만 지원합니다. 최대 10MB, 1000행까지 처리합니다.
        </p>

        <div className="mt-4">
          <label
            htmlFor="quote-file"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-navy-200 bg-navy-50/50 p-6 transition hover:border-teal-300 hover:bg-teal-50/30"
          >
            <FileSpreadsheet className="h-8 w-8 text-navy-400" aria-hidden />
            <span className="text-xs font-semibold text-navy-600">
              클릭해서 엑셀 파일을 선택하세요
            </span>
            <input
              id="quote-file"
              name="file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className="block w-full text-xs text-navy-600 file:mr-3 file:rounded-md file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white file:hover:bg-teal-700"
            />
          </label>
        </div>

        {/* 에러 표시 */}
        {state.error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="font-semibold">{state.error}</div>
          </div>
        )}

        {/* 제출 버튼 */}
        <div className="mt-5 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                분석 중...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden />
                임포트 실행
              </>
            )}
          </button>
        </div>
      </form>

      {/* 결과 요약 */}
      {state.ok && state.summary && <ResultSummary summary={state.summary} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 요약 컴포넌트
// ─────────────────────────────────────────────────────────

interface ResultSummaryProps {
  summary: NonNullable<QuoteImportActionState['summary']>;
}

function ResultSummary({ summary }: ResultSummaryProps) {
  return (
    <section className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-800">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
        임포트 결과 — {summary.sourceFileName}
      </h2>

      {/* 카운터 카드 */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <CounterCard label="저장됨" count={summary.inserted} variant="success" />
        <CounterCard label="미매칭" count={summary.unmatched} variant="warning" />
        <CounterCard label="중복 스킵" count={summary.skipped} variant="neutral" />
        <CounterCard label="파싱 실패" count={summary.failed} variant="danger" />
      </div>

      {/* 인식된 컬럼 */}
      {summary.detectedColumns.length > 0 && (
        <div className="mt-4 rounded-md border border-navy-100 bg-navy-50/40 p-3">
          <div className="text-[11px] font-semibold uppercase text-navy-500">
            인식된 컬럼 ({summary.detectedColumns.length}개)
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {summary.detectedColumns.map((c) => (
              <span
                key={c}
                className="rounded bg-white px-2 py-0.5 text-[10px] font-mono text-navy-600 ring-1 ring-navy-200"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 행별 결과 */}
      {summary.rows.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase text-navy-500">
            행별 상세 ({summary.rows.length}행)
          </div>
          <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto rounded-md border border-navy-200 bg-white p-2">
            {summary.rows.map((r, idx) => (
              <RowResultItem key={`${r.sourceRow}-${idx}`} row={r} />
            ))}
          </ul>
        </div>
      )}

      {/* 도움말 */}
      {(summary.unmatched > 0 || summary.failed > 0) && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            저장되지 않은 행이 있습니다
          </div>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
            <li>
              미매칭: 엑셀의 상품/공급사가 시스템에 없어서 못 찾았습니다.{' '}
              <Link
                href="/products/new"
                className="font-semibold underline hover:text-amber-900"
              >
                상품 등록
              </Link>
              {' 또는 '}
              <Link
                href="/sourcing/suppliers/new"
                className="font-semibold underline hover:text-amber-900"
              >
                공급사 등록
              </Link>
              {' 후 같은 파일을 다시 업로드하면 이미 저장된 행은 자동 중복 스킵됩니다.'}
            </li>
            <li>파싱 실패: 해당 행의 단가나 숫자 필드가 비어있거나 형식이 맞지 않습니다.</li>
          </ul>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 카운터 카드
// ─────────────────────────────────────────────────────────

interface CounterCardProps {
  label: string;
  count: number;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
}

function CounterCard({ label, count, variant }: CounterCardProps) {
  const styles: Record<CounterCardProps['variant'], string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-800',
    neutral: 'border-navy-200 bg-navy-50 text-navy-700',
  };
  return (
    <div className={`rounded-md border p-3 ${styles[variant]}`}>
      <div className="text-[10px] font-semibold uppercase opacity-75">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold">{count.toLocaleString('ko-KR')}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 행 결과 아이템
// ─────────────────────────────────────────────────────────

interface RowResultItemProps {
  row: QuoteImportRowSummary;
}

function RowResultItem({ row }: RowResultItemProps) {
  const icons = {
    inserted: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />,
    unmatched: <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />,
    failed: <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden />,
    skipped: <AlertCircle className="h-3.5 w-3.5 text-navy-400" aria-hidden />,
  };
  const labels: Record<QuoteImportRowSummary['status'], string> = {
    inserted: '저장',
    unmatched: '미매칭',
    failed: '실패',
    skipped: '스킵',
  };

  return (
    <li className="flex items-start gap-2 rounded border border-transparent px-2 py-1 text-[11px] hover:border-navy-100 hover:bg-navy-50/40">
      {icons[row.status]}
      <span className="font-mono text-[10px] text-navy-400 shrink-0">행 {row.sourceRow}</span>
      <span className="shrink-0 font-semibold text-navy-600">[{labels[row.status]}]</span>
      <span className="min-w-0 flex-1 truncate text-navy-700">
        {row.rawProductName && <span className="font-semibold">{row.rawProductName}</span>}
        {row.rawProductCode && (
          <span className="ml-1 font-mono text-navy-500">({row.rawProductCode})</span>
        )}
        {row.rawSupplierName && (
          <span className="ml-1 text-navy-500">· {row.rawSupplierName}</span>
        )}
        {row.message && <span className="ml-1 text-red-600">— {row.message}</span>}
      </span>
    </li>
  );
}
