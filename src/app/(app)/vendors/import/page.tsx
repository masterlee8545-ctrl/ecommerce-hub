/**
 * /vendors/import — 농가 CSV 임포트 통로
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (한국어, 비개발자 친화)
 * ADR: ADR-012, ADR-013
 *
 * 역할:
 *   사이소·김제몰류 크롤링 CSV (UTF-8 BOM, 영문/한글 헤더) 를 업로드해서
 *   현재 회사의 vendors 마스터에 머지.
 *
 *   1. 파일 선택 → 미리보기 (헤더 인식 + 신규/업데이트 건수)
 *   2. 확정 클릭 → 트랜잭션 INSERT/UPDATE
 *
 * Phase B 2번 PR 에서 "공급처 찾기" 탭이 이 데이터를 사용함.
 */
import Link from 'next/link';

import { Database, FileUp } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';

import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function VendorsImportPage() {
  await requireCompanyContext();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-600">
          <Database className="h-5 w-5" aria-hidden />
          농가 마스터
        </div>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">
          농가 / 공급처 CSV 임포트
        </h1>
        <p className="mt-2 text-base text-navy-500">
          사이소·김제몰 등에서 모은 농가 CSV 를 업로드하면 이 법인의 농가 마스터에
          저장됩니다. 같은 농가가 여러 몰에 있으면 사업자번호로 자동 묶입니다.
        </p>
      </header>

      {/* 도움말 */}
      <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-5 text-sm text-navy-700">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-emerald-800">
          <FileUp className="h-4 w-4" />
          업로드 가능한 파일
        </h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code className="rounded bg-white px-1 py-0.5 text-xs">cyso_all_sellers.csv</code>
            {' — 사이소 22개 몰 (영문 헤더, 1,728건)'}
          </li>
          <li>
            <code className="rounded bg-white px-1 py-0.5 text-xs">all_sellers.csv</code>
            {' — 김제몰·jpsmall (한글 헤더, 239건)'}
          </li>
          <li>그 외 같은 형태의 CSV (UTF-8 BOM, site/slug/업체명 또는 bizName 컬럼 필수)</li>
        </ul>
        <p className="mt-3 text-xs text-navy-500">
          ※ 같은 회사 안에서 한 농가가 여러 몰에 입점한 경우, 사업자번호 → 업체명+주소 → 업체명+대표자 순으로 자동 매칭됩니다.
          매칭된 row 는 새로 만들지 않고 <code>also_listed_on</code> 컬럼에 출처가 추가됩니다.
        </p>
      </section>

      {/* 업로드 폼 */}
      <ImportForm />

      <div className="text-sm text-navy-500">
        <Link href="/vendors" className="text-blue-600 hover:underline">
          ← 농가 검색으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
