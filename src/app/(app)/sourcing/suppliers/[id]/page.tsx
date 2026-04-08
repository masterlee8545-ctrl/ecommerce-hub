/**
 * /sourcing/suppliers/[id] — 공급사 상세 + 수정 페이지
 *
 * 출처: D-2c (공급사 상세 + 생성 페이지)
 * 헌법: CLAUDE.md §1 P-1 (없는 데이터는 404), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 공급사 상세 정보 표시 + 동일 페이지에서 수정 가능
 * - getSupplierById로 한 건 조회 (RLS 적용 → 다른 회사 데이터 자동 차단)
 * - 없으면 notFound() — Next.js 404 페이지로
 *
 * 보안 (P-4):
 * - requireCompanyContext + withCompanyContext 안에서 쿼리
 * - 다른 회사의 supplierId를 URL에 직접 입력해도 0건 → notFound()
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Building2, Calendar, Pencil } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { updateSupplierAction } from '@/lib/sourcing/actions';
import { getSupplierById, type SupplierSource } from '@/lib/sourcing/suppliers';

import { SupplierForm } from '../supplier-form';

export const dynamic = 'force-dynamic';

interface SupplierDetailPageProps {
  params: Promise<{ id: string }>;
}

// ─────────────────────────────────────────────────────────
// 출처 메타
// ─────────────────────────────────────────────────────────

const SOURCE_META: Record<SupplierSource, { label: string; color: string }> = {
  '1688': { label: '1688', color: 'bg-orange-50 text-orange-700' },
  taobao: { label: '타오바오', color: 'bg-pink-50 text-pink-700' },
  domestic: { label: '국내', color: 'bg-blue-50 text-blue-700' },
  other: { label: '기타', color: 'bg-navy-50 text-navy-600' },
};

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function SupplierDetailPage({ params }: SupplierDetailPageProps) {
  const { id } = await params;
  const ctx = await requireCompanyContext();

  const supplier = await getSupplierById(ctx.companyId, id);
  if (!supplier) {
    notFound();
  }

  const sourceMeta =
    SOURCE_META[supplier.source as SupplierSource] ?? SOURCE_META.other;

  // 수정 액션은 supplierId를 미리 바인딩해서 폼에 전달
  const editAction = updateSupplierAction.bind(null, supplier.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/sourcing"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          공급사 목록으로
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <Building2 className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-navy-900">{supplier.name}</h1>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${sourceMeta.color}`}
                >
                  {sourceMeta.label}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-navy-500">
                <Calendar className="h-3 w-3" aria-hidden />
                등록 {formatDateTime(supplier.created_at)}
                {supplier.updated_at.getTime() !== supplier.created_at.getTime() && (
                  <span className="ml-2 text-navy-400">
                    · 마지막 수정 {formatDateTime(supplier.updated_at)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* 수정 폼 카드 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Pencil className="h-4 w-4 text-navy-500" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
            정보 수정
          </h2>
        </div>
        <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
          <SupplierForm
            action={editAction}
            mode="edit"
            defaultValues={{
              name: supplier.name,
              source: supplier.source as SupplierSource,
              source_url: supplier.source_url,
              contact_info: supplier.contact_info,
              rating: supplier.rating,
              notes: supplier.notes,
            }}
          />
        </div>
      </section>

      {/* 디버그 정보 */}
      <p className="text-[10px] text-navy-400">
        ID: <code className="rounded bg-navy-50 px-1 py-0.5 font-mono">{supplier.id}</code>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
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
