/**
 * 장바구니 목록 — 다중 선택 + 일괄 전환 (수입 의뢰 / 위탁판매)
 *
 * 각 카드에 체크박스 + 개별 "수입 의뢰로" / "위탁판매로" 버튼.
 * 선택된 상품들에 대해 상단 툴바의 "일괄 수입" / "일괄 위탁판매" 버튼으로 한 번에 전환.
 *
 * 위탁판매 vs 수입 구분: transitionProductStatusAction 의 reason 필드에 "수입" or "위탁판매" 기록
 * (products.status 는 sourcing 단계로 동일, 구분은 history 와 description 으로).
 */
'use client';

import { useRef, useState, useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ArrowRight, ExternalLink, Loader2, Package, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { bulkDeleteProductsAction, bulkTransitionAction } from '@/lib/products/actions';

interface BasketItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export function BasketList({ items }: { items: BasketItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // Shift+클릭 범위 선택용 — 마지막으로 토글한 items 배열 인덱스
  const lastClickedIndexRef = useRef<number | null>(null);

  function toggleAt(index: number, shiftKey: boolean) {
    const target = items[index];
    if (!target) return;

    const last = lastClickedIndexRef.current;
    if (shiftKey && last !== null && last !== index) {
      // 범위 선택/해제: 현재 클릭 카드의 새 상태를 범위 전체에 적용
      const from = Math.min(last, index);
      const to = Math.max(last, index);
      const rangeIds = items.slice(from, to + 1).map((i) => i.id);
      const shouldSelect = !selected.has(target.id);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of rangeIds) {
          if (shouldSelect) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
    }
    lastClickedIndexRef.current = index;
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function bulkDelete(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length}개 상품을 장바구니에서 삭제할까요?\n(삭제 후 복구 불가)`)) {
      return;
    }
    const loadingId = toast.loading(`${ids.length}개 삭제 중...`);
    const formData = new FormData();
    for (const id of ids) formData.append('productIds', id);

    startTransition(async () => {
      try {
        const res = await bulkDeleteProductsAction(formData);
        if (res.ok) {
          toast.success(`${res.deleted}개 삭제 완료`, {
            id: loadingId,
            description: res.error,
            duration: 4000,
          });
        } else {
          toast.error('삭제 실패', { id: loadingId, description: res.error });
        }
        clearAll();
        router.refresh();
      } catch (err) {
        toast.error('삭제 실패', {
          id: loadingId,
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async function bulkTransit(reason: '수입' | '위탁판매') {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const label = reason === '수입' ? '수입 의뢰' : '위탁판매';
    const loadingId = toast.loading(`${ids.length}개 ${label} 단계로 전환 중...`);

    const formData = new FormData();
    for (const id of ids) formData.append('productIds', id);
    formData.set('toStatus', 'sourcing');
    formData.set('reason', reason);

    startTransition(async () => {
      try {
        const res = await bulkTransitionAction(formData);
        if (res.ok) {
          toast.success(`${res.success}개 ${label} 단계로 전환됨 ✓`, {
            id: loadingId,
            duration: 4000,
          });
        } else {
          toast.error(`${res.success}개 성공 / ${res.failed}개 실패`, {
            id: loadingId,
            description: res.error,
          });
        }
        clearAll();
        router.refresh();
      } catch (err) {
        toast.error('전환 실패', {
          id: loadingId,
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-10 text-center">
        <Package className="mx-auto h-10 w-10 text-navy-300" />
        <p className="mt-2 text-sm font-semibold text-navy-600">장바구니가 비어있습니다</p>
        <p className="mt-1 text-xs text-navy-400">
          위 폼에서 상품을 추가하면 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  const allSelected = selected.size === items.length && items.length > 0;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-2">
      {/* 선택 툴바 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-navy-200 bg-white px-3 py-2 shadow-sm">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-navy-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => (e.target.checked ? selectAll() : clearAll())}
            className="h-4 w-4"
          />
          전체 선택
        </label>
        <span className="text-xs text-navy-500">
          {selected.size > 0 ? `선택 ${selected.size}/${items.length}` : `${items.length}개`}
        </span>

        {someSelected && (
          <>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-navy-500 hover:text-red-600"
            >
              해제
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => bulkDelete(Array.from(selected))}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-400 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {selected.size}개 삭제
              </button>
              <button
                type="button"
                onClick={() => bulkTransit('수입')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs font-bold text-yellow-800 transition hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '📦'}
                {selected.size}개 수입 의뢰로
              </button>
              <button
                type="button"
                onClick={() => bulkTransit('위탁판매')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-green-400 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-800 transition hover:bg-green-100 disabled:cursor-wait disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '🌾'}
                {selected.size}개 위탁판매로
              </button>
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-[11px] text-navy-400">
        💡 체크박스 <kbd className="rounded border border-navy-300 bg-white px-1 font-mono text-[10px]">Shift</kbd>+클릭으로 범위 선택 가능
      </p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <BasketCard
            key={item.id}
            item={item}
            isSelected={selected.has(item.id)}
            onToggle={(shiftKey) => toggleAt(index, shiftKey)}
            onIndividualTransit={async (reason) => {
              setSelected(new Set([item.id]));
              await bulkTransit(reason);
            }}
            onIndividualDelete={async () => {
              await bulkDelete([item.id]);
            }}
            disabled={isPending}
          />
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 개별 카드
// ─────────────────────────────────────────────────────────

function BasketCard({
  item,
  isSelected,
  onToggle,
  onIndividualTransit,
  onIndividualDelete,
  disabled,
}: {
  item: BasketItem;
  isSelected: boolean;
  onToggle: (shiftKey: boolean) => void;
  onIndividualTransit: (reason: '수입' | '위탁판매') => void;
  onIndividualDelete: () => void;
  disabled: boolean;
}) {
  const lines = (item.description ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const sourceLine = lines.find((l) => l.startsWith('소스: '));
  const sourceUrl = sourceLine ? sourceLine.replace('소스: ', '').trim() : null;
  const metaLines = lines.filter((l) => /^[📊🏆⭐🚀📦💰📅]/u.test(l));
  const hasSelloMeta = metaLines.length > 0;
  const freeMemo = lines
    .filter(
      (l) =>
        !l.startsWith('소스: ')
        && !/^[📊🏆⭐🚀📦💰📅]/u.test(l)
        && l !== '셀록홈즈 카테고리 소싱',
    )
    .join(' ')
    .trim();

  // 카테고리가 농산물/수산물/축산물 이면 위탁판매 기본 추천
  const isConsignCategory = /농산물|수산물|축산물|과일/.test(item.description ?? '');

  return (
    <li
      className={`rounded-lg border bg-white p-4 transition ${
        isSelected ? 'border-violet-400 bg-violet-50/30' : 'border-navy-200 hover:border-teal-300'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 체크박스 — Shift+클릭 범위 선택 지원 */}
        <label
          className="mt-1 shrink-0 cursor-pointer"
          title="Shift+클릭으로 범위 선택"
          onClick={(e) => {
            e.preventDefault();
            onToggle(e.shiftKey);
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {
              /* label onClick 이 처리 — React warning 방지 noop */
            }}
            className="h-4 w-4 cursor-pointer"
          />
        </label>

        {/* 상품 정보 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/products/${item.id}`}
              className="text-sm font-semibold text-navy-900 hover:text-teal-700"
            >
              {item.name}
            </Link>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-500">
              {item.code}
            </span>
            {hasSelloMeta && (
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                셀록홈즈
              </span>
            )}
            {isConsignCategory && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                🌾 위탁판매 추천
              </span>
            )}
          </div>

          {hasSelloMeta && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {metaLines.map((line, i) => (
                <span
                  key={i}
                  className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
                >
                  {line}
                </span>
              ))}
            </div>
          )}

          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="h-3 w-3" />
              소스 링크
            </a>
          )}
          {freeMemo && <p className="mt-1 text-xs text-navy-500">{freeMemo}</p>}
          <div className="mt-1 text-[10px] text-navy-400">{formatDate(item.created_at)}</div>
        </div>

        {/* 우측: 개별 전환 버튼 */}
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onIndividualTransit(isConsignCategory ? '위탁판매' : '수입')}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              isConsignCategory
                ? 'border-green-400 bg-green-50 text-green-800 hover:bg-green-100'
                : 'border-yellow-400 bg-yellow-50 text-yellow-800 hover:bg-yellow-100'
            }`}
          >
            {isConsignCategory ? '🌾 위탁판매로' : '📦 수입 의뢰로'}
            <ArrowRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onIndividualTransit(isConsignCategory ? '수입' : '위탁판매')}
            className="inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-2.5 py-1 text-[10px] text-navy-500 transition hover:border-navy-300 hover:text-navy-700 disabled:opacity-50"
          >
            {isConsignCategory ? '수입 의뢰로' : '위탁판매로'}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onIndividualDelete}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] text-red-500 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
            title="장바구니에서 삭제"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </li>
  );
}

function formatDate(date: Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const SHORT_YEAR_DIGITS = 2;
  const YEAR_END = 4;
  const y = d.getFullYear().toString().slice(YEAR_END - SHORT_YEAR_DIGITS);
  const m = (d.getMonth() + 1).toString().padStart(SHORT_YEAR_DIGITS, '0');
  const day = d.getDate().toString().padStart(SHORT_YEAR_DIGITS, '0');
  const hh = d.getHours().toString().padStart(SHORT_YEAR_DIGITS, '0');
  const mm = d.getMinutes().toString().padStart(SHORT_YEAR_DIGITS, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}
