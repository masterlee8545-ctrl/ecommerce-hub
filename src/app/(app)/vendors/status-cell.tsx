/**
 * 농가 상태 인라인 편집 셀
 * 형 요청: 통화실패/없는번호/소싱실패/탈락 빠르게 기록
 */
'use client';

import { useState } from 'react';

import { toast } from 'sonner';

const STATUS_OPTIONS = [
  { value: 'active', label: '✅ 활성', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'no_phone', label: '📵 번호없음', color: 'bg-navy-50 text-navy-600 border-navy-200' },
  { value: 'no_answer', label: '☎ 부재중', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'sourcing_failed', label: '💸 소싱실패', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'dropped', label: '🚫 탈락', color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'contracted', label: '🤝 거래중', color: 'bg-blue-50 text-blue-700 border-blue-200' },
] as const;

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o]));

interface Props {
  vendorId: string;
  initialStatus: string;
  initialNote: string | null;
}

export function VendorStatusCell({ vendorId, initialStatus, initialNote }: Props) {
  const [status, setStatus] = useState(initialStatus || 'active');
  const [note, setNote] = useState(initialNote ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const meta = STATUS_MAP[status] ?? STATUS_OPTIONS[0];

  async function save(newStatus: string, newNote: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_status: newStatus, status_note: newNote || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? `저장 실패 (${res.status})`);
        return;
      }
      setStatus(newStatus);
      setNote(newNote);
      setEditing(false);
      toast.success('저장됨');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={saving}
          className="rounded-md border border-navy-300 px-2 py-1 text-xs"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
          placeholder="메모 (예: 5/18 부재중)"
          className="rounded-md border border-navy-300 px-2 py-1 text-xs"
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => save(status, note)}
            disabled={saving}
            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => {
              setStatus(initialStatus || 'active');
              setNote(initialNote ?? '');
              setEditing(false);
            }}
            disabled={saving}
            className="rounded border border-navy-300 bg-white px-2 py-0.5 text-xs text-navy-600 hover:bg-navy-50"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`flex flex-col items-start gap-0.5 rounded border px-2 py-1 text-left text-xs ${meta.color} hover:opacity-80`}
      title="클릭하면 편집"
    >
      <span className="font-semibold">{meta.label}</span>
      {note && (
        <span className="text-[10px] font-normal opacity-80 line-clamp-1">{note}</span>
      )}
    </button>
  );
}
