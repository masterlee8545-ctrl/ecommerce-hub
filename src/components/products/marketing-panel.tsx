/**
 * 마케팅 활동 패널 — Step 7
 *
 * 역할: 상품별 마케팅 활동(체험단/블로그/CPC/기타)을 리스트·추가·상태전환.
 *
 * 헌법: CLAUDE.md §1 P-9 (한국어), §1 P-1 (빈 결과 명시)
 */
'use client';

import { useState } from 'react';

import { CheckCircle2, Megaphone, PlayCircle, Plus, XCircle } from 'lucide-react';

import { MARKETING_CHANNEL_LABELS, MARKETING_CHANNELS, type MarketingActivity, type MarketingChannel, type MarketingStatus } from '@/db/schema';
import { createActivityAction, updateActivityStatusAction } from '@/lib/marketing/actions';

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MarketingPanelProps {
  productId: string;
  activities: MarketingActivity[];
  members: Member[];
}

const STATUS_LABEL: Record<MarketingStatus, { label: string; color: string }> = {
  pending: { label: '대기', color: 'bg-navy-50 text-navy-600 border-navy-200' },
  in_progress: { label: '진행중', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  done: { label: '완료', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: '취소', color: 'bg-red-50 text-red-700 border-red-200' },
};

export function MarketingPanel({ productId, activities, members }: MarketingPanelProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section id="marketing-panel" className="rounded-lg border border-purple-200 bg-purple-50/30 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <Megaphone className="h-4 w-4 text-purple-700" />
          마케팅 · 리뷰 작업 ({activities.length}건)
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-white px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50"
        >
          <Plus className="h-3 w-3" />
          {showForm ? '닫기' : '작업 추가'}
        </button>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <form
          action={createActivityAction}
          className="mb-4 space-y-2 rounded-md border border-purple-100 bg-white p-3"
        >
          <input type="hidden" name="productId" value={productId} />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <label htmlFor="channel" className="block text-[11px] font-semibold text-navy-700">
                채널 <span className="text-red-500">*</span>
              </label>
              <select
                id="channel"
                name="channel"
                required
                defaultValue=""
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-xs text-navy-900 focus:border-purple-500 focus:outline-none"
              >
                <option value="" disabled>선택하세요</option>
                {MARKETING_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {MARKETING_CHANNEL_LABELS[c as MarketingChannel]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assigneeId" className="block text-[11px] font-semibold text-navy-700">
                담당자
              </label>
              <select
                id="assigneeId"
                name="assigneeId"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-xs text-navy-900 focus:border-purple-500 focus:outline-none"
              >
                <option value="">— 미배정 —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="costKrw" className="block text-[11px] font-semibold text-navy-700">
                비용 (원)
              </label>
              <input
                type="number"
                id="costKrw"
                name="costKrw"
                min="0"
                step="1000"
                placeholder="0"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-xs text-navy-900 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="block text-[11px] font-semibold text-navy-700">
              메모 (선택)
            </label>
            <input
              type="text"
              id="notes"
              name="notes"
              placeholder="예: 체험단 플랫폼명, 인스타 계정, 타겟 키워드 등"
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-xs text-navy-900 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
            >
              추가
            </button>
          </div>
        </form>
      )}

      {/* 활동 리스트 */}
      {activities.length === 0 ? (
        <p className="py-6 text-center text-xs text-navy-400">
          아직 마케팅 작업이 없습니다. 체험단·블로그·인스타·쿠팡 CPC 등 채널별로 추가하세요.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {activities.map((a) => (
            <ActivityRow
              key={a.id}
              activity={a}
              productId={productId}
              memberMap={new Map(members.map((m) => [m.id, m.name]))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({
  activity,
  productId,
  memberMap,
}: {
  activity: MarketingActivity;
  productId: string;
  memberMap: Map<string, string>;
}) {
  const channelLabel = MARKETING_CHANNEL_LABELS[activity.channel as MarketingChannel] ?? activity.channel;
  const statusMeta = STATUS_LABEL[activity.status as MarketingStatus] ?? { label: activity.status, color: '' };
  const assigneeName = activity.assignee_id ? memberMap.get(activity.assignee_id) ?? '알 수 없음' : '미배정';
  const cost = activity.cost_krw !== null ? Number(activity.cost_krw) : null;

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-navy-100 bg-white px-3 py-2 text-xs text-navy-800">
      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
        {channelLabel}
      </span>
      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusMeta.color}`}>
        {statusMeta.label}
      </span>
      <span className="text-[11px] text-navy-500">
        {assigneeName}
      </span>
      {cost !== null && cost > 0 && (
        <span className="text-[11px] text-navy-500">
          ₩{cost.toLocaleString('ko-KR')}
        </span>
      )}
      {activity.notes && (
        <span className="truncate text-[11px] text-navy-500" title={activity.notes}>
          · {activity.notes}
        </span>
      )}

      {/* 상태 전환 버튼 */}
      <div className="ml-auto flex items-center gap-1">
        {activity.status === 'pending' && (
          <StatusButton activityId={activity.id} productId={productId} next="in_progress" icon={<PlayCircle className="h-3 w-3" />} label="시작" />
        )}
        {activity.status === 'in_progress' && (
          <StatusButton activityId={activity.id} productId={productId} next="done" icon={<CheckCircle2 className="h-3 w-3" />} label="완료" />
        )}
        {activity.status !== 'cancelled' && activity.status !== 'done' && (
          <StatusButton activityId={activity.id} productId={productId} next="cancelled" icon={<XCircle className="h-3 w-3" />} label="취소" />
        )}
      </div>
    </li>
  );
}

function StatusButton({
  activityId,
  productId,
  next,
  icon,
  label,
}: {
  activityId: string;
  productId: string;
  next: MarketingStatus;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <form action={updateActivityStatusAction} className="inline-flex">
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="nextStatus" value={next} />
      <button
        type="submit"
        className="inline-flex items-center gap-0.5 rounded border border-navy-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-navy-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
        title={`${label}`}
      >
        {icon}
        {label}
      </button>
    </form>
  );
}
