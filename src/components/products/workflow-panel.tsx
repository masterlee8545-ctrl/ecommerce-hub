/**
 * 상품 워크플로우 패널 — 1688 링크 + 담당자 3명 + 기획서·마케팅 바로가기
 *
 * 헌법: CLAUDE.md §1 P-9 (한국어)
 *
 * 역할 (Step 3 · 5 · 4 · 7 연결):
 * - 1688 링크 편집 + 표시 (수입업체 인계용)
 * - 담당자 3명 배정 (기획·등록·로켓)
 * - 상세페이지 기획서 페이지 링크
 * - 마케팅 작업 탭 링크 (추후 구현)
 */
'use client';

import Link from 'next/link';

import { ExternalLink, FileText, Megaphone, Save, Users } from 'lucide-react';

import { updateWorkflowAction } from '@/lib/products/actions';

interface Member {
  id: string;
  name: string;
  email: string;
}

interface WorkflowPanelProps {
  productId: string;
  initialCnSourceUrl: string | null;
  initialPlanAssigneeId: string | null;
  initialListingAssigneeId: string | null;
  initialRocketAssigneeId: string | null;
  members: Member[];
  /** 기획서 존재 여부 — 링크 라벨 용 */
  hasPlan: boolean;
  /** 편집 가능 여부 — false 면 readonly + 저장 버튼 숨김 (Phase C: manager+ 만) */
  canEdit: boolean;
}

export function WorkflowPanel({
  productId,
  initialCnSourceUrl,
  initialPlanAssigneeId,
  initialListingAssigneeId,
  initialRocketAssigneeId,
  members,
  hasPlan,
  canEdit,
}: WorkflowPanelProps) {
  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/30 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-900">
        <Users className="h-4 w-4 text-teal-700" />
        워크플로우 · 담당자
      </h2>

      <form action={updateWorkflowAction} className="space-y-3">
        <input type="hidden" name="productId" value={productId} />

        {/* 1688 링크 */}
        <div>
          <label htmlFor="cnSourceUrl" className="block text-xs font-semibold text-navy-700">
            🔗 1688 / 타오바오 링크 (수입업체 인계용)
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              type="url"
              id="cnSourceUrl"
              name="cnSourceUrl"
              defaultValue={initialCnSourceUrl ?? ''}
              placeholder="https://detail.1688.com/offer/..."
              disabled={!canEdit}
              className="flex-1 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-500"
            />
            {initialCnSourceUrl && (
              <a
                href={initialCnSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-3 text-xs font-semibold text-navy-600 hover:border-teal-300 hover:text-teal-700"
                title="새 탭에서 열기"
              >
                <ExternalLink className="h-3 w-3" />
                열기
              </a>
            )}
          </div>
        </div>

        {/* 담당자 3명 */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <AssigneeSelect
            label="상세페이지 담당"
            sublabel="(Step 4 — 기획서 제작)"
            name="planAssigneeId"
            initialValue={initialPlanAssigneeId}
            members={members}
            disabled={!canEdit}
          />
          <AssigneeSelect
            label="상품 등록 담당"
            sublabel="(Step 6)"
            name="listingAssigneeId"
            initialValue={initialListingAssigneeId}
            members={members}
            disabled={!canEdit}
          />
          <AssigneeSelect
            label="로켓 입점 담당"
            sublabel="(Step 8)"
            name="rocketAssigneeId"
            initialValue={initialRocketAssigneeId}
            members={members}
            disabled={!canEdit}
          />
        </div>

        {/* 저장 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href={`/products/${productId}/plan`}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
            >
              <FileText className="h-3.5 w-3.5" />
              {hasPlan ? '기획서 열기' : '기획서 만들기'}
            </Link>
            <a
              href="#marketing-panel"
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition hover:bg-purple-100"
            >
              <Megaphone className="h-3.5 w-3.5" />
              마케팅 작업
            </a>
          </div>
          {canEdit ? (
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700"
            >
              <Save className="h-3.5 w-3.5" />
              저장
            </button>
          ) : (
            <span className="text-[11px] text-navy-400" title="담당자 배정·1688 링크 편집은 매니저 이상만 가능합니다.">
              🔒 읽기 전용
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function AssigneeSelect({
  label,
  sublabel,
  name,
  initialValue,
  members,
  disabled,
}: {
  label: string;
  sublabel: string;
  name: string;
  initialValue: string | null;
  members: Member[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-semibold text-navy-700">
        {label}
        <span className="ml-1 text-[10px] font-normal text-navy-400">{sublabel}</span>
      </label>
      <select
        id={name}
        name={name}
        defaultValue={initialValue ?? ''}
        disabled={disabled}
        className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-500"
      >
        <option value="">— 미배정 —</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.email})
          </option>
        ))}
      </select>
    </div>
  );
}
