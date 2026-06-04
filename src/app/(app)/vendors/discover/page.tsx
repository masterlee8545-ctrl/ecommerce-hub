/**
 * /vendors/discover — 외부 공급처 발굴 (네이버 + 카카오)
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2.5번 PR
 * 헌법: CLAUDE.md §1 P-9
 *
 * 역할:
 *   - 검색창에 "고체 탈취제" 같이 자연어 입력
 *   - 네이버 블로그/지식인 → 브랜드 후보 추출
 *   - 카카오 로컬 → 정확한 전화번호/주소 검증
 *   - 결과 카드에 [vendors 에 추가] 버튼
 */
import Link from 'next/link';

import { Search } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';

import { DiscoverClient } from './client';

export const dynamic = 'force-dynamic';

export default async function VendorDiscoverPage() {
  await requireCompanyContext();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-purple-600">
          <Search className="h-5 w-5" />
          외부 공급처 발굴
        </div>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">공급처 외부 검색</h1>
        <p className="mt-2 text-sm text-navy-500">
          DB 에 없는 공급처를 네이버 블로그/지식인 + 카카오 로컬 사업장 검색으로 즉시 발굴.
          결과에서 [추가] 누르면 농가 마스터에 저장됩니다.
        </p>
      </header>

      <DiscoverClient />

      <div className="text-sm text-navy-500">
        <Link href="/vendors" className="text-blue-600 hover:underline">
          ← 농가 검색으로
        </Link>
      </div>
    </div>
  );
}
