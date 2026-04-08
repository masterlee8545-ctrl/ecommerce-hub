/**
 * /sourcing/quotes/import — 견적 엑셀 일괄 임포트 페이지 (F-2d)
 *
 * 출처: F-2 엑셀 벌크 임포트
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 — 인증 강제), §1 P-9 (사용자 친화 한국어),
 *       §1 P-1 (빈 결과 은폐 금지 — 매칭/파싱 실패 행도 모두 보여줌)
 *
 * 역할:
 * - 인증된 사용자에게 엑셀 업로드 UI 제공
 * - bulkImportQuotesAction을 ImportForm에 주입
 * - 지원 포맷과 예상 컬럼을 안내하여 업로드 실패율 최소화
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제 → 미인증 시 자동 /login
 * - 파일 크기/확장자 검증은 서버 액션에서 수행
 */
import Link from 'next/link';

import { ArrowLeft, FileSpreadsheet, Info } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { bulkImportQuotesAction } from '@/lib/sourcing/actions';

import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function QuoteImportPage() {
  // 인증 강제 — 결과는 사용하지 않지만 미인증 요청을 차단
  await requireCompanyContext();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/sourcing/quotes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          견적 목록으로
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <FileSpreadsheet className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-900">견적 엑셀 일괄 임포트</h1>
            <p className="mt-0.5 text-sm text-navy-500">
              수입 대행업체에게 받은 견적 엑셀을 한 번에 업로드해 자동으로 저장합니다. 한 건씩
              등록하려면{' '}
              <Link
                href="/sourcing/quotes/new"
                className="font-semibold text-teal-700 underline hover:text-teal-900"
              >
                새 견적 등록
              </Link>
              을 이용하세요.
            </p>
          </div>
        </div>
      </header>

      {/* 예상 컬럼 안내 */}
      <section className="rounded-lg border border-navy-200 bg-navy-50/40 p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-navy-700">
          <Info className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          엑셀 준비 가이드
        </div>
        <ul className="mt-2 space-y-1 text-[11px] text-navy-600">
          <li>
            <span className="font-semibold">첫 행(1행)</span>은 반드시 헤더여야 합니다. 2행부터
            데이터로 인식합니다.
          </li>
          <li>
            <span className="font-semibold">필수 컬럼</span>: 상품코드 또는 상품명, 공급사(수입
            대행업체)명, 공급단가(원화).
          </li>
          <li>
            <span className="font-semibold">선택 컬럼</span>: CNY 단가, VAT 포함 여부, VAT율, MOQ,
            리드타임(일), 결제조건, 사양, 비고.
          </li>
          <li>
            상품코드/상품명/공급사명은 시스템에 등록된 값과 정확히 일치해야 매칭됩니다. 매칭되지
            않은 행은 &ldquo;미매칭&rdquo;으로 표시되며 저장되지 않습니다.
          </li>
          <li>
            같은 파일을 다시 올려도 이미 저장된 행은 자동으로 스킵되므로 안전하게 재업로드할 수
            있습니다.
          </li>
        </ul>
      </section>

      {/* 업로드 + 결과 */}
      <ImportForm action={bulkImportQuotesAction} />
    </div>
  );
}
