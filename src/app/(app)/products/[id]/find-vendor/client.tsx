/**
 * 농가 자동 매칭 카드 — 클라이언트 인터랙션
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2번 PR
 * 헌법: CLAUDE.md §1 P-9
 *
 * 카드별 액션:
 *   - [⭐ 후보] → POST /api/products/[id]/vendor-candidates status=후보
 *   - [❌ 탈락] → status=탈락
 *   - [📞 통화] → tel: 자동 발신 (모바일) — 통화 기록 모달은 3번 PR
 *   - [상세] → /vendors/[id]
 */
'use client';

import { useState, useTransition } from 'react';

import Link from 'next/link';


import {
  Award,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Phone,
  Star,
  Tag,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { CallLogModal } from './call-modal';

export interface VendorCard {
  vendor: {
    id: string;
    biz_name: string;
    biz_owner_name: string | null;
    biz_no: string | null;
    biz_no_confidence: string;
    repr_tel_no: string | null;
    biz_mobile: string | null;
    biz_address: string | null;
    biz_sector: string | null;
    classification: string | null;
    product_count: number | null;
    product_keywords_all: string | null;
    source_site: string;
    also_listed_on: string[];
  };
  score: number;
  reasons: string[];
  matchedKeywords: string[];
  candidateStatus: '후보' | '통화중' | '견본중' | '확정' | '탈락' | null;
}

interface Props {
  productId: string;
  cards: VendorCard[];
}

const STATUS_COLOR: Record<string, string> = {
  후보: 'bg-blue-50 text-blue-700 border-blue-200',
  통화중: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  견본중: 'bg-amber-50 text-amber-700 border-amber-200',
  확정: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  탈락: 'bg-red-50 text-red-700 border-red-200',
};

export function VendorCandidatesClient({ productId, cards }: Props) {
  const [localStatus, setLocalStatus] = useState<Record<string, string | null>>(
    Object.fromEntries(cards.map((c) => [c.vendor.id, c.candidateStatus])),
  );
  const [pending, startTransition] = useTransition();
  const [callModalVendor, setCallModalVendor] = useState<VendorCard['vendor'] | null>(null);

  async function setStatus(vendorId: string, status: '후보' | '탈락') {
    const prev = localStatus[vendorId];
    setLocalStatus((s) => ({ ...s, [vendorId]: status }));

    startTransition(async () => {
      try {
        const res = await fetch(`/api/products/${productId}/vendor-candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor_id: vendorId, status }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !json.ok) {
          toast.error(json.error ?? `저장 실패 (${res.status})`);
          setLocalStatus((s) => ({ ...s, [vendorId]: prev ?? null }));
          return;
        }
        toast.success(status === '후보' ? '후보로 추가됨' : '탈락 처리됨');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장 실패');
        setLocalStatus((s) => ({ ...s, [vendorId]: prev ?? null }));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-navy-500">
        총 <strong className="text-navy-900">{cards.length}</strong>곳의 농가가 매칭됐어요. 점수는
        품목 일치 + 시즌 적합 + 다중 입점 + 지역 + 사업자 확인 기준입니다.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const status = localStatus[c.vendor.id] ?? null;
          return (
            <div
              key={c.vendor.id}
              className={`flex flex-col rounded-lg border bg-white p-4 transition-shadow hover:shadow-md ${
                status === '탈락' ? 'opacity-60' : ''
              }`}
            >
              {/* 점수 + 상태 */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Award className="h-4 w-4 text-emerald-600" />
                  <span className="text-lg font-bold text-emerald-700">{c.score}점</span>
                </div>
                {status && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLOR[status] ?? ''
                    }`}
                  >
                    {status}
                  </span>
                )}
              </div>

              {/* 업체명 + 대표 */}
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-navy-900">{c.vendor.biz_name}</h3>
                <p className="text-xs text-navy-500">
                  {c.vendor.biz_owner_name ?? '-'}
                  {c.vendor.biz_no_confidence === 'confirmed' && (
                    <span className="ml-1 text-emerald-600">✓</span>
                  )}
                </p>
              </div>

              {/* 매칭 이유 */}
              <ul className="mt-2 space-y-0.5">
                {c.reasons.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1 text-xs text-navy-600"
                  >
                    <Star className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>

              {/* 전화번호 — 큼직하게 즉시 보임 (클릭 시 자동 발신) */}
              <div className="mt-3 space-y-1 rounded-md bg-blue-50/50 p-2">
                {c.vendor.repr_tel_no && (
                  <a
                    href={`tel:${c.vendor.repr_tel_no.replace(/[^\d+]/g, '')}`}
                    className="flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900 hover:underline"
                    title="대표 번호 — 클릭 시 자동 발신"
                  >
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                    {c.vendor.repr_tel_no}
                  </a>
                )}
                {c.vendor.biz_mobile && (
                  <a
                    href={`tel:${c.vendor.biz_mobile.replace(/[^\d+]/g, '')}`}
                    className="flex items-center gap-2 text-sm font-bold text-emerald-700 hover:text-emerald-900 hover:underline"
                    title="휴대전화 — 클릭 시 자동 발신"
                  >
                    📱 {c.vendor.biz_mobile}
                  </a>
                )}
                {!c.vendor.repr_tel_no && !c.vendor.biz_mobile && (
                  <span className="text-xs text-navy-400">연락처 없음 — 출처에서 확인 필요</span>
                )}
              </div>

              {/* 주소 + 출처 */}
              {c.vendor.biz_address && (
                <p className="mt-2 line-clamp-1 text-xs text-navy-500">
                  📍 {c.vendor.biz_address}
                </p>
              )}
              <p className="mt-1 line-clamp-1 text-xs text-navy-400">
                {c.vendor.source_site}
                {c.vendor.also_listed_on.length > 0 && (
                  <span className="ml-1 text-emerald-600">
                    + {c.vendor.also_listed_on.length}개 몰
                  </span>
                )}
              </p>

              {/* 품목 */}
              {c.vendor.product_keywords_all && (
                <div className="mt-2 flex items-start gap-1 text-xs text-navy-600">
                  <Tag className="mt-0.5 h-3 w-3 flex-shrink-0 text-navy-400" />
                  <span className="line-clamp-2">{c.vendor.product_keywords_all}</span>
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
                <button
                  type="button"
                  onClick={() => setCallModalVendor(c.vendor)}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  title="통화 결과 + 공급가 기록"
                >
                  <MessageSquare className="h-3 w-3" />
                  통화 기록
                </button>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setStatus(c.vendor.id, '후보')}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  후보
                </button>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setStatus(c.vendor.id, '탈락')}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                  탈락
                </button>

                <Link
                  href={`/vendors/${c.vendor.id}`}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  상세
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-navy-400">
        ※ [통화 기록] 클릭 → 결과 + 공급가 + MOQ + 메모 입력 → 저장
      </p>

      {callModalVendor && (
        <CallLogModal
          vendor={callModalVendor}
          productId={productId}
          onClose={() => setCallModalVendor(null)}
          onSaved={() => {
            // 통화 기록 저장 후 후보 자동 추가
            setStatus(callModalVendor.id, '후보');
          }}
        />
      )}
    </div>
  );
}
