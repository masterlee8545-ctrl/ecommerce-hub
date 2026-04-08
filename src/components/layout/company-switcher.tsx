/**
 * 회사 전환 드롭다운 — 클라이언트 컴포넌트
 *
 * 출처: 헤더 우측에 표시되는 회사 선택 UI
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 현재 활성 회사 이름 표시
 * - 클릭 시 사용자가 속한 다른 회사 목록 펼침
 * - 회사 선택 시 switchCompanyAction 호출 → 페이지 리로드
 *
 * 디자인 결정:
 * - shadcn/ui DropdownMenu 사용 (이미 설치돼 있음)
 * - 회사 이름 옆에 비즈니스 타입 배지 (industrial/agricultural/other)
 * - 현재 회사는 체크 표시
 */
'use client';

import { useTransition } from 'react';

import { Check, ChevronsUpDown } from 'lucide-react';

import { switchCompanyAction } from '@/lib/auth/actions';
import type { CompanyWithRole } from '@/lib/auth/company';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────
// 비즈니스 타입 한국어 라벨 + 배지 색상
// ─────────────────────────────────────────────────────────

const BUSINESS_TYPE_LABEL: Record<CompanyWithRole['businessType'], string> = {
  industrial: '공산',
  agricultural: '농산',
  other: '기타',
};

const BUSINESS_TYPE_COLOR: Record<CompanyWithRole['businessType'], string> = {
  industrial: 'bg-blue-50 text-blue-700',
  agricultural: 'bg-green-50 text-green-700',
  other: 'bg-navy-50 text-navy-700',
};

const ROLE_LABEL: Record<CompanyWithRole['role'], string> = {
  owner: '대표',
  manager: '관리자',
  operator: '실무자',
};

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

interface CompanySwitcherProps {
  /** 현재 활성 회사 ID (세션에서 전달) */
  activeCompanyId: string;
  /** 사용자가 속한 모든 회사 (서버에서 미리 조회) */
  companies: CompanyWithRole[];
}

export function CompanySwitcher({ activeCompanyId, companies }: CompanySwitcherProps) {
  const [isPending, startTransition] = useTransition();

  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  // 멤버십이 1개뿐이면 드롭다운 대신 정적 표시
  const isSingle = companies.length <= 1;

  function handleSelect(companyId: string) {
    if (companyId === activeCompanyId || isPending) return;
    startTransition(async () => {
      await switchCompanyAction(companyId);
    });
  }

  if (!activeCompany) {
    return (
      <div className="text-sm text-score-bad">회사 정보를 불러올 수 없습니다.</div>
    );
  }

  return (
    <div className="relative">
      {/* 트리거 — 항상 보임 */}
      <details className="group">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center gap-2 rounded-md border border-navy-200 bg-white px-3 py-1.5 text-sm transition hover:border-teal-300 hover:bg-teal-50/30',
            isSingle && 'cursor-default hover:border-navy-200 hover:bg-white',
            isPending && 'opacity-60',
          )}
        >
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold',
              BUSINESS_TYPE_COLOR[activeCompany.businessType],
            )}
          >
            {BUSINESS_TYPE_LABEL[activeCompany.businessType]}
          </span>
          <span className="font-medium text-navy-900">{activeCompany.name}</span>
          <span className="text-xs text-navy-500">· {ROLE_LABEL[activeCompany.role]}</span>
          {!isSingle && (
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-navy-400" aria-hidden />
          )}
        </summary>

        {/* 드롭다운 패널 — 멤버십 1개면 표시 안 함 */}
        {!isSingle && (
          <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-md border border-navy-200 bg-white shadow-lg">
            <div className="border-b border-navy-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
              회사 전환
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {companies.map((company) => {
                const isActive = company.id === activeCompanyId;
                return (
                  <li key={company.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(company.id)}
                      disabled={isPending}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition',
                        isActive
                          ? 'bg-teal-50 text-teal-700'
                          : 'text-navy-700 hover:bg-navy-50',
                        isPending && 'cursor-wait opacity-60',
                      )}
                    >
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          BUSINESS_TYPE_COLOR[company.businessType],
                        )}
                      >
                        {BUSINESS_TYPE_LABEL[company.businessType]}
                      </span>
                      <span className="flex-1 truncate font-medium">{company.name}</span>
                      <span className="text-xs text-navy-500">{ROLE_LABEL[company.role]}</span>
                      {isActive && <Check className="h-4 w-4 text-teal-600" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}
