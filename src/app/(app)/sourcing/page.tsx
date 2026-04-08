/**
 * /sourcing — 소싱 단계 진입 페이지 (공급사 목록)
 *
 * 출처: docs/SPEC.md §3 Sourcing 단계, D-2b
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 회사의 공급사 목록을 시간순(최신부터)으로 보여줌
 * - "공급사 등록" 버튼으로 /sourcing/suppliers/new 진입
 * - 각 행: 이름, 출처(1688/taobao/...), 평점(★), 등록일
 * - 클릭 시 → /sourcing/suppliers/[id] 상세
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 인증 + 회사 컨텍스트
 * 2. listSuppliers({ companyId, limit }) — RLS 자동 적용
 * 3. 빈 목록이면 안내 카드, 있으면 카드 그리드 렌더
 *
 * 보안 (P-4):
 * - withCompanyContext 안에서 쿼리되므로 다른 회사 데이터 0% 노출
 */
import Link from 'next/link';

import { ArrowRight, Building2, ExternalLink, Plus, ReceiptText, Star, Truck } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import { listSuppliers, type SupplierSource } from '@/lib/sourcing/suppliers';

export const dynamic = 'force-dynamic';

const SUPPLIERS_LIMIT = 50;
const MAX_RATING_STARS = 5;

// ─────────────────────────────────────────────────────────
// 출처 메타데이터
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

export default async function SourcingPage() {
  const ctx = await requireCompanyContext();

  // DB 조회 — 빈 목록이거나 DB 미준비 시 빈 배열로 폴백
  let rows: Awaited<ReturnType<typeof listSuppliers>> = [];
  let dbError: string | null = null;
  try {
    rows = await listSuppliers({ companyId: ctx.companyId, limit: SUPPLIERS_LIMIT });
  } catch (err) {
    console.error('[sourcing] listSuppliers 실패:', err);
    dbError =
      err instanceof Error
        ? `공급사 목록 조회 중 오류: ${err.message}`
        : '공급사 목록을 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-yellow-700">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-50 text-[10px] font-bold">
            2
          </span>
          파이프라인 2단계
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">소싱</h1>
            <p className="mt-1 text-sm text-navy-500">
              상품을 받아올 공급사를 등록하고 관리합니다. 1688 / 타오바오 / 국내 / 기타.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sourcing/quotes"
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              <ReceiptText className="h-3.5 w-3.5" aria-hidden />
              견적 목록
            </Link>
            <Link
              href="/sourcing/suppliers/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              공급사 등록
            </Link>
          </div>
        </div>
      </header>

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">
              등록된 공급사 ({rows.length}곳)
            </h2>
            <span className="text-[11px] text-navy-400">최신 등록순 · 최대 {SUPPLIERS_LIMIT}곳</span>
          </div>

          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rows.map((supplier) => (
              <SupplierCard key={supplier.id} supplier={supplier} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────

interface SupplierCardProps {
  supplier: Awaited<ReturnType<typeof listSuppliers>>[number];
}

function SupplierCard({ supplier }: SupplierCardProps) {
  const sourceMeta =
    SOURCE_META[supplier.source as SupplierSource] ?? SOURCE_META.other;

  return (
    <li>
      <Link
        href={`/sourcing/suppliers/${supplier.id}`}
        className="group block rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
      >
        {/* 상단: 이름 + 출처 배지 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <Building2 className="h-4 w-4" aria-hidden />
            </div>
            <h3 className="truncate text-sm font-semibold text-navy-900 group-hover:text-teal-700">
              {supplier.name}
            </h3>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${sourceMeta.color}`}
          >
            {sourceMeta.label}
          </span>
        </div>

        {/* 평점 + 연락처 + 등록일 */}
        <div className="mt-3 space-y-1.5 text-[11px] text-navy-500">
          {supplier.rating !== null && (
            <div className="flex items-center gap-1">
              <RatingStars value={supplier.rating} />
              <span className="font-mono text-navy-400">({supplier.rating}/5)</span>
            </div>
          )}
          {supplier.contact_info && (
            <div className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-navy-400" aria-hidden />
              <span className="truncate">{supplier.contact_info}</span>
            </div>
          )}
          {supplier.source_url && (
            <div className="flex items-center gap-1">
              <ExternalLink className="h-3 w-3 text-navy-400" aria-hidden />
              <span className="truncate text-navy-500">{supplier.source_url}</span>
            </div>
          )}
        </div>

        {/* 하단: 등록일 + 화살표 */}
        <div className="mt-3 flex items-center justify-between border-t border-navy-100 pt-2">
          <span className="text-[10px] text-navy-400">
            등록 {formatDate(supplier.created_at)}
          </span>
          <ArrowRight
            className="h-3 w-3 text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600"
            aria-hidden
          />
        </div>
      </Link>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 평점 별
// ─────────────────────────────────────────────────────────

function RatingStars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(MAX_RATING_STARS, value));
  return (
    <span className="inline-flex" aria-label={`평점 ${filled}점 / ${MAX_RATING_STARS}점`}>
      {Array.from({ length: MAX_RATING_STARS }, (_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i < filled ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-navy-200'
          }`}
          aria-hidden
        />
      ))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <Building2 className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">아직 등록된 공급사가 없습니다</h2>
      <p className="mt-1 text-xs text-navy-500">
        첫 번째 공급사를 등록하면 견적 / 발주 / 통관 단계로 연결됩니다.
      </p>
      <Link
        href="/sourcing/suppliers/new"
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
      >
        <Plus className="h-4 w-4" aria-hidden />첫 공급사 등록하기
      </Link>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">공급사 목록을 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결 또는 마이그레이션 적용을 확인하세요. (`npm run db:push`)
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  try {
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(date);
  }
}
