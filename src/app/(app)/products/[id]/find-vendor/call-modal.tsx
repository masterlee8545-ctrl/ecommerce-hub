/**
 * 농가 통화 기록 모달 — 형 요청 (3번 PR)
 *
 * 통화 후 30초 안에:
 *   - 통화 결과 (연결됨/부재중/거절/견본 요청 등)
 *   - 공급가 + 단위 (kg/박스/개)
 *   - MOQ + 단위
 *   - 메모
 *   - 다음 액션 + 날짜
 */
'use client';

import { useState } from 'react';

import { CheckCircle2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  vendor: {
    id: string;
    biz_name: string;
    repr_tel_no: string | null;
    biz_mobile: string | null;
  };
  productId: string;
  onClose: () => void;
  onSaved: () => void;
}

const RESULT_OPTIONS = [
  { value: '연결됨', label: '✅ 연결됨', color: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { value: '부재중', label: '📵 부재중', color: 'border-navy-300 bg-navy-50 text-navy-700' },
  { value: '거절', label: '❌ 거절', color: 'border-red-300 bg-red-50 text-red-700' },
  { value: '견본_요청', label: '📦 견본 요청', color: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: '거래_시작', label: '🤝 거래 시작', color: 'border-blue-300 bg-blue-50 text-blue-700' },
  { value: '탈락', label: '🚫 탈락', color: 'border-red-300 bg-red-50 text-red-700' },
] as const;

const NEXT_ACTION_OPTIONS = [
  { value: '재통화', label: '☎ 재통화' },
  { value: '견본_대기', label: '📦 견본 대기' },
  { value: '계약_검토', label: '📄 계약 검토' },
] as const;

const PRICE_UNITS = ['kg', '박스', '개', 'L', '봉지', '세트'];
const MOQ_UNITS = ['박스', '개', 'kg', '세트'];

export function CallLogModal({ vendor, productId, onClose, onSaved }: Props) {
  const [channel, setChannel] = useState<'phone' | 'kakao' | 'visit' | 'other'>('phone');
  const [result, setResult] = useState<string>('');
  const [supplierPrice, setSupplierPrice] = useState('');
  const [supplierPriceUnit, setSupplierPriceUnit] = useState('kg');
  const [moq, setMoq] = useState('');
  const [moqUnit, setMoqUnit] = useState('박스');
  const [notes, setNotes] = useState('');
  const [nextAction, setNextAction] = useState<string>('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!result) {
      toast.error('통화 결과를 선택하세요');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/call-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          channel,
          result,
          notes: notes || undefined,
          next_action: nextAction || null,
          next_action_at: nextActionAt || null,
          supplier_price: supplierPrice ? Number(supplierPrice) : null,
          supplier_price_unit: supplierPrice ? supplierPriceUnit : null,
          moq: moq ? Number(moq) : null,
          moq_unit: moq ? moqUnit : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? `저장 실패 (${res.status})`);
        return;
      }
      toast.success('통화 기록 저장됨');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setSaving(false);
    }
  }

  const phone = vendor.repr_tel_no ?? vendor.biz_mobile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-2xl">
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-navy-900">📞 통화 기록 — {vendor.biz_name}</h2>
            {phone && (
              <a
                href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                className="text-sm text-blue-600 hover:underline"
              >
                {phone} (모바일이면 자동 발신)
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 채널 */}
          <div>
            <label className="block text-xs font-semibold text-navy-700 mb-1">채널</label>
            <div className="flex gap-2">
              {(['phone', 'kakao', 'visit', 'other'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    channel === c
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-navy-200 text-navy-600'
                  }`}
                >
                  {c === 'phone' && '☎ 전화'}
                  {c === 'kakao' && '💬 카톡'}
                  {c === 'visit' && '🚶 방문'}
                  {c === 'other' && '기타'}
                </button>
              ))}
            </div>
          </div>

          {/* 결과 (필수) */}
          <div>
            <label className="block text-xs font-semibold text-navy-700 mb-1">
              결과 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {RESULT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setResult(opt.value)}
                  className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                    result === opt.value ? opt.color : 'border-navy-200 text-navy-500 hover:border-navy-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 공급가 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">공급가 (원)</label>
              <div className="flex">
                <input
                  type="number"
                  inputMode="numeric"
                  value={supplierPrice}
                  onChange={(e) => setSupplierPrice(e.target.value)}
                  placeholder="예: 5000"
                  className="flex-1 rounded-l-md border border-navy-300 px-3 py-2 text-sm"
                />
                <select
                  value={supplierPriceUnit}
                  onChange={(e) => setSupplierPriceUnit(e.target.value)}
                  className="rounded-r-md border-y border-r border-navy-300 bg-navy-50 px-2 text-sm"
                >
                  {PRICE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      /{u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">최소주문량 (MOQ)</label>
              <div className="flex">
                <input
                  type="number"
                  inputMode="numeric"
                  value={moq}
                  onChange={(e) => setMoq(e.target.value)}
                  placeholder="예: 5"
                  className="flex-1 rounded-l-md border border-navy-300 px-3 py-2 text-sm"
                />
                <select
                  value={moqUnit}
                  onChange={(e) => setMoqUnit(e.target.value)}
                  className="rounded-r-md border-y border-r border-navy-300 bg-navy-50 px-2 text-sm"
                >
                  {MOQ_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-xs font-semibold text-navy-700 mb-1">메모</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="예: 다음주부터 출하 시작, 박스당 5kg 단위, 배송비 별도"
              rows={2}
              className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
            />
          </div>

          {/* 다음 액션 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">다음 액션</label>
              <select
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
              >
                <option value="">선택 안함</option>
                {NEXT_ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">언제</label>
              <input
                type="date"
                value={nextActionAt}
                onChange={(e) => setNextActionAt(e.target.value)}
                className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-navy-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-navy-300 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !result}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                저장 중...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
