/**
 * 원가/판매가/마진 실시간 계산기 (클라이언트 컴포넌트)
 *
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 한국어), §1 P-3 (estimated 마킹)
 *
 * 역할:
 * - 원가(원) + 판매가(원) 입력 → 마진액 + 마진율 자동 계산
 * - 쿠팡 수수료율(기본 10.8%) 반영
 * - 결과를 상품에 저장하는 Server Action 연결
 *
 * 사용법:
 * ```tsx
 * <CostCalculator productId="..." onSave={savePricingAction} />
 * ```
 */
'use client';

import { useState, useMemo } from 'react';

import { Calculator, Save } from 'lucide-react';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const DEFAULT_FEE_RATE = 10.8; // 쿠팡 기본 수수료 %
const PERCENT = 100;

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

interface CostCalculatorProps {
  /** 상품 ID — 저장 시 사용 */
  productId?: string | undefined;
  /** 초기 원가 (원) */
  initialCost?: number | undefined;
  /** 초기 판매가 (원) */
  initialPrice?: number | undefined;
  /** 저장 Server Action (form submit) */
  saveAction?: ((form: FormData) => void) | undefined;
}

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function CostCalculator({
  productId,
  initialCost,
  initialPrice,
  saveAction,
}: CostCalculatorProps) {
  const [costKrw, setCostKrw] = useState(initialCost?.toString() ?? '');
  const [sellingPrice, setSellingPrice] = useState(initialPrice?.toString() ?? '');
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE.toString());

  const calc = useMemo(() => {
    const cost = parseNumber(costKrw);
    const price = parseNumber(sellingPrice);
    const fee = parseNumber(feeRate);

    if (cost === null || price === null) {
      return null;
    }

    const feeAmount = fee !== null ? price * (fee / PERCENT) : 0;
    const profit = price - cost - feeAmount;
    const marginRate = price > 0 ? (profit / price) * PERCENT : 0;

    return {
      cost,
      price,
      feeAmount: Math.round(feeAmount),
      profit: Math.round(profit),
      marginRate: Number(marginRate.toFixed(1)),
      marginRateDecimal: price > 0 ? profit / price : 0,
    };
  }, [costKrw, sellingPrice, feeRate]);

  const isPositiveMargin = calc !== null && calc.profit > 0;

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <Calculator className="h-4 w-4 text-teal-600" />
        원가/판매가 계산기
      </h3>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* 원가 */}
        <div>
          <label htmlFor="calc-cost" className="block text-xs font-semibold text-navy-700">
            원가 (원)
          </label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-navy-400">₩</span>
            <input
              type="text"
              id="calc-cost"
              inputMode="numeric"
              value={costKrw}
              onChange={(e) => setCostKrw(e.target.value)}
              placeholder="5,000"
              className="block w-full rounded-md border border-navy-200 bg-white py-2 pl-7 pr-3 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <p className="mt-0.5 text-[10px] text-navy-400">수입대행 업체에 지불하는 금액</p>
        </div>

        {/* 판매가 */}
        <div>
          <label htmlFor="calc-price" className="block text-xs font-semibold text-navy-700">
            판매가 (원)
          </label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-navy-400">₩</span>
            <input
              type="text"
              id="calc-price"
              inputMode="numeric"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              placeholder="15,000"
              className="block w-full rounded-md border border-navy-200 bg-white py-2 pl-7 pr-3 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <p className="mt-0.5 text-[10px] text-navy-400">쿠팡/네이버 판매 가격</p>
        </div>

        {/* 수수료율 */}
        <div>
          <label htmlFor="calc-fee" className="block text-xs font-semibold text-navy-700">
            수수료율 (%)
          </label>
          <div className="relative mt-1">
            <input
              type="text"
              id="calc-fee"
              inputMode="decimal"
              value={feeRate}
              onChange={(e) => setFeeRate(e.target.value)}
              placeholder="10.8"
              className="block w-full rounded-md border border-navy-200 bg-white px-3 py-2 pr-7 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-400">%</span>
          </div>
          <p className="mt-0.5 text-[10px] text-navy-400">쿠팡 기본 10.8%</p>
        </div>
      </div>

      {/* 계산 결과 */}
      {calc !== null && (
        <div className="mt-4 rounded-md border border-navy-100 bg-navy-50/40 p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <ResultItem label="원가" value={`₩${formatKrw(calc.cost)}`} />
            <ResultItem
              label="수수료"
              value={`₩${formatKrw(calc.feeAmount)}`}
              sub={`${feeRate}%`}
            />
            <ResultItem
              label="순이익"
              value={`₩${formatKrw(calc.profit)}`}
              color={isPositiveMargin ? 'text-emerald-700' : 'text-red-600'}
            />
            <ResultItem
              label="마진율"
              value={`${calc.marginRate}%`}
              color={isPositiveMargin ? 'text-emerald-700' : 'text-red-600'}
              highlight
            />
          </div>
        </div>
      )}

      {/* 저장 버튼 */}
      {saveAction && productId && calc !== null && (
        <form action={saveAction} className="mt-3">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="cogsKrw" value={calc.cost.toString()} />
          <input type="hidden" name="sellingPriceKrw" value={calc.price.toString()} />
          <input type="hidden" name="marginRate" value={calc.marginRateDecimal.toString()} />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            <Save className="h-4 w-4" />
            상품에 저장
          </button>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────────────────

function ResultItem({
  label,
  value,
  sub,
  color,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase text-navy-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${color ?? 'text-navy-800'} ${highlight ? 'text-lg' : ''}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-navy-400">{sub}</div>}
    </div>
  );
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned.length === 0) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR');
}
