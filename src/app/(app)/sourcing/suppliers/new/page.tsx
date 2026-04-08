/**
 * /sourcing/suppliers/new — 새 공급사 등록 페이지
 *
 * 출처: D-2c (공급사 상세 + 생성 페이지)
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트 — 인증 강제), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 인증된 사용자에게 공급사 등록 폼 제공
 * - SupplierForm + createSupplierAction 조합
 * - 성공 시 Server Action이 /sourcing/suppliers/[id] 로 redirect
 *
 * 보안:
 * - requireCompanyContext()로 인증 강제 → 미인증 시 자동 /login
 * - companyId는 폼에 노출하지 않음 (Server Action이 세션에서 직접 추출)
 */
import Link from 'next/link';

import { ArrowLeft, Building2 } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { createSupplierAction } from '@/lib/sourcing/actions';

import { SupplierForm } from '../supplier-form';

export const dynamic = 'force-dynamic';

export default async function NewSupplierPage() {
  // 인증 강제 (미인증 시 자동 /login 리디렉션)
  await requireCompanyContext();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/sourcing"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          공급사 목록으로
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Building2 className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-900">새 공급사 등록</h1>
            <p className="mt-0.5 text-sm text-navy-500">
              상품을 받아올 새 공급사 정보를 입력하세요. 필수 항목만 채우면 시작할 수 있습니다.
            </p>
          </div>
        </div>
      </header>

      {/* 폼 카드 */}
      <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        <SupplierForm action={createSupplierAction} mode="create" />
      </div>

      {/* 안내 */}
      <p className="text-[11px] text-navy-400">
        💡 등록 후에도 모든 항목은 언제든지 수정할 수 있습니다.
      </p>
    </div>
  );
}
