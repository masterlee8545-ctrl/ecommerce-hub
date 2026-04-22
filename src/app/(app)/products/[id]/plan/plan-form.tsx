/**
 * 기획서 편집 폼 (클라이언트) — /products/[id]/plan 내부에서 사용
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-9 (사용자 친화 한국어)
 *
 * 필드:
 * - hookSummary        — 상품의 핵심 후킹/차별화 요약
 * - targetAudience     — 누가 이 상품을 살까 (고객 페르소나)
 * - sections(JSON)     — 섹션 배열 (position, title, imageDesc, color, copy, hook)
 * - notes              — 담당자에게 전달할 특이사항
 * - resultConfidence   — 'estimated' | 'edited' | 'confirmed'
 *
 * JSON 수동 편집 — MVP 라 섹션별 UI 안 만들고 한 번에 텍스트 에어리어 로 받는다.
 * (추후 섹션별 추가/삭제/정렬 UI 로 교체 예정 — 사용자 피드백 반영)
 */
'use client';

import { useState } from 'react';

import { Save } from 'lucide-react';

import { savePlanAction } from '@/lib/products/actions';
import type { PlanSection } from '@/lib/products/plans';

interface PlanFormProps {
  productId: string;
  initialHookSummary: string;
  initialTargetAudience: string;
  initialNotes: string;
  initialSections: PlanSection[];
  initialConfidence: string;
}

export function PlanForm({
  productId,
  initialHookSummary,
  initialTargetAudience,
  initialNotes,
  initialSections,
  initialConfidence,
}: PlanFormProps) {
  const [sectionsJson, setSectionsJson] = useState<string>(
    JSON.stringify(initialSections, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  function validateJson(value: string) {
    if (value.trim().length === 0) {
      setJsonError(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        setJsonError('JSON 배열이어야 합니다 (`[...]`).');
      } else {
        setJsonError(null);
      }
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON 형식 오류');
    }
  }

  return (
    <form action={savePlanAction} className="space-y-4 rounded-lg border border-navy-200 bg-white p-5">
      <input type="hidden" name="productId" value={productId} />

      {/* 후킹 요약 */}
      <div>
        <label htmlFor="hookSummary" className="block text-xs font-semibold text-navy-700">
          핵심 후킹 · 차별화 요약
        </label>
        <textarea
          id="hookSummary"
          name="hookSummary"
          defaultValue={initialHookSummary}
          placeholder="이 상품이 경쟁사 대비 어떤 점이 다른가? 한두 문장으로 요약."
          rows={2}
          className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {/* 타겟 고객 */}
      <div>
        <label htmlFor="targetAudience" className="block text-xs font-semibold text-navy-700">
          타겟 고객 (누가 살까)
        </label>
        <textarea
          id="targetAudience"
          name="targetAudience"
          defaultValue={initialTargetAudience}
          placeholder="예: 30~40대 주부, 손 아픈 것에 민감, 키친 인테리어 관심"
          rows={2}
          className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {/* 섹션 JSON */}
      <div>
        <label htmlFor="sectionsJson" className="block text-xs font-semibold text-navy-700">
          섹션 배열 (JSON)
        </label>
        <textarea
          id="sectionsJson"
          name="sectionsJson"
          value={sectionsJson}
          onChange={(e) => {
            setSectionsJson(e.target.value);
            validateJson(e.target.value);
          }}
          rows={16}
          spellCheck={false}
          placeholder='[\n  { "position": 0, "title": "메인 후킹", "imageDesc": "...", "color": "...", "copy": "...", "hook": "..." }\n]'
          className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 font-mono text-xs text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        {jsonError ? (
          <p className="mt-1 text-[11px] text-red-600">⚠ {jsonError}</p>
        ) : (
          <p className="mt-1 text-[11px] text-navy-400">
            AI 가 뽑아준 JSON 배열을 그대로 붙여넣으세요. 검증은 저장 시 엄격하게.
          </p>
        )}
      </div>

      {/* 메모 */}
      <div>
        <label htmlFor="notes" className="block text-xs font-semibold text-navy-700">
          담당자 전달 메모
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initialNotes}
          placeholder="디자인 톤, 피해야 할 표현, 기타 주의사항"
          rows={2}
          className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {/* 상태 */}
      <div>
        <label htmlFor="resultConfidence" className="block text-xs font-semibold text-navy-700">
          현재 상태
        </label>
        <select
          id="resultConfidence"
          name="resultConfidence"
          defaultValue={initialConfidence}
          className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="estimated">🟡 AI 초안 (수정 전)</option>
          <option value="edited">🔵 사용자 수정 중</option>
          <option value="confirmed">🟢 최종 확정 (담당자 인계 가능)</option>
        </select>
      </div>

      {/* 저장 */}
      <button
        type="submit"
        disabled={jsonError !== null}
        className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        기획서 저장
      </button>
    </form>
  );
}
