/**
 * 실마진 계산기 — 1688 단가 → 관부가세 → 쿠팡 수수료 → 진짜 남는 돈
 *
 * 헌법: CLAUDE.md §1 P-9 (사용자 친화 — 비개발자 형이 바로 쓰는 도구)
 *
 * 동기 (2026-06-11 형 요청):
 *   "평균가 2만원이니 마진 50% 되겠지"는 추정. 실제로는
 *   관세+부가세+쿠팡수수료+광고비+반품까지 빼면 절반이 탈락한다.
 *   등록 100개 중 실마진 검증된 상품 0개 → 등록 전 검증 의무화 도구.
 *
 * 계산 (해외 공급 기준):
 *   상품원가₩ = 단가¥ × 환율
 *   국제배송 = 무게kg × 배송단가
 *   과세가격 = 상품원가 + 국제배송 (CIF 근사)
 *   관세 = 과세가격 × 관세율 (기본 8%)
 *   부가세 = (과세가격 + 관세) × 10%
 *   입고원가 = 과세가격 + 관세 + 부가세
 *   판매비용 = 판매가 × (쿠팡수수료% + 광고% + 반품충당%) + 국내택배
 *   실마진 = 판매가 − 입고원가 − 판매비용
 *
 * 국내 공급 (농산물): 관부가세/국제배송 생략, 입고원가 = 원가₩.
 */
'use client';

import { useMemo, useState } from 'react';

import { Calculator } from 'lucide-react';

const DEFAULT_FX = 195; //          ₩/¥
const DEFAULT_WEIGHT_G = 500;
const DEFAULT_SHIP_PER_KG = 8000; // 국제배송 ₩/kg (1688 배대지 평균)
const DEFAULT_DUTY_PCT = 8; //      관세율 (생활용품 평균)
const VAT_PCT = 10;
const DEFAULT_COUPANG_FEE_PCT = 10.8;
const DEFAULT_AD_PCT = 10;
const DEFAULT_RETURN_PCT = 3;
const DEFAULT_DOMESTIC_SHIP = 3000;

interface MarginCalculatorProps {
  /** 등록된 원가 (위안) — 초기값 */
  initialCny: number | null;
  /** 등록된 원가 (원) — 국내 공급일 때 초기값 */
  initialKrw: number | null;
  /** 'domestic_vendor' 면 관부가세 생략 모드 */
  supplyType: string | null;
  /** 쿠팡 1페이지 중간가 — 판매가 초기값 */
  marketMedian: number | null;
  /** 쿠팡 1페이지 최저가 */
  marketMin: number | null;
  /** 쿠팡 1페이지 최고가 */
  marketMax: number | null;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function MarginCalculator({
  initialCny,
  initialKrw,
  supplyType,
  marketMedian,
  marketMin,
  marketMax,
}: MarginCalculatorProps) {
  const isDomestic = supplyType === 'domestic_vendor';

  const [cny, setCny] = useState(initialCny !== null ? String(initialCny) : '');
  const [krw, setKrw] = useState(initialKrw !== null ? String(initialKrw) : '');
  const [fx, setFx] = useState(String(DEFAULT_FX));
  const [weightG, setWeightG] = useState(String(DEFAULT_WEIGHT_G));
  const [shipPerKg, setShipPerKg] = useState(String(DEFAULT_SHIP_PER_KG));
  const [dutyPct, setDutyPct] = useState(String(DEFAULT_DUTY_PCT));
  const [coupangFeePct, setCoupangFeePct] = useState(String(DEFAULT_COUPANG_FEE_PCT));
  const [adPct, setAdPct] = useState(String(DEFAULT_AD_PCT));
  const [returnPct, setReturnPct] = useState(String(DEFAULT_RETURN_PCT));
  const [domesticShip, setDomesticShip] = useState(String(DEFAULT_DOMESTIC_SHIP));
  const [price, setPrice] = useState(
    marketMedian !== null ? String(marketMedian) : '',
  );

  const result = useMemo(() => {
    const sellingPrice = num(price);
    if (sellingPrice <= 0) return null;

    // 입고원가
    let landed: number;
    let duty = 0;
    let vat = 0;
    let intlShip = 0;
    if (isDomestic) {
      landed = num(krw);
      if (landed <= 0) return null;
    } else {
      const goods = num(cny) * num(fx);
      if (goods <= 0) return null;
      intlShip = (num(weightG) / 1000) * num(shipPerKg);
      const dutiable = goods + intlShip;
      duty = dutiable * (num(dutyPct) / 100);
      vat = (dutiable + duty) * (VAT_PCT / 100);
      landed = dutiable + duty + vat;
    }

    // 판매 비용
    const feeRate = (num(coupangFeePct) + num(adPct) + num(returnPct)) / 100;
    const fees = sellingPrice * feeRate + num(domesticShip);
    const margin = sellingPrice - landed - fees;
    const marginPct = (margin / sellingPrice) * 100;
    // 손익분기: price×(1−feeRate) = landed + 택배
    const breakeven =
      feeRate < 1 ? (landed + num(domesticShip)) / (1 - feeRate) : null;

    const atPrice = (p: number | null) => {
      if (p === null || p <= 0) return null;
      const m = p - landed - (p * feeRate + num(domesticShip));
      return { price: p, margin: m, pct: (m / p) * 100 };
    };

    return {
      landed,
      duty,
      vat,
      intlShip,
      fees,
      margin,
      marginPct,
      breakeven,
      scenarios: [atPrice(marketMin), atPrice(marketMedian), atPrice(marketMax)],
    };
  }, [
    price, cny, krw, fx, weightG, shipPerKg, dutyPct,
    coupangFeePct, adPct, returnPct, domesticShip, isDomestic,
    marketMin, marketMedian, marketMax,
  ]);

  const verdict =
    result === null
      ? null
      : result.marginPct >= 30
        ? { label: '충분', color: 'bg-emerald-100 text-emerald-700' }
        : result.marginPct >= 15
          ? { label: '빠듯', color: 'bg-amber-100 text-amber-700' }
          : { label: '위험', color: 'bg-red-100 text-red-700' };

  return (
    <section className="rounded-lg border border-navy-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-700">
        <Calculator className="h-4 w-4 text-navy-500" aria-hidden />
        실마진 계산기
        <span className="text-[10px] font-normal text-navy-400">
          {isDomestic ? '국내 공급 (관부가세 없음)' : '1688 수입 (관세+부가세+수수료 포함)'}
        </span>
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {isDomestic ? (
          <Field label="원가 (₩)" value={krw} onChange={setKrw} />
        ) : (
          <>
            <Field label="1688 단가 (¥)" value={cny} onChange={setCny} />
            <Field label="환율 (₩/¥)" value={fx} onChange={setFx} />
            <Field label="무게 (g)" value={weightG} onChange={setWeightG} />
            <Field label="국제배송 (₩/kg)" value={shipPerKg} onChange={setShipPerKg} />
            <Field label="관세율 (%)" value={dutyPct} onChange={setDutyPct} />
          </>
        )}
        <Field label="쿠팡 수수료 (%)" value={coupangFeePct} onChange={setCoupangFeePct} />
        <Field label="광고비 (%)" value={adPct} onChange={setAdPct} />
        <Field label="반품 충당 (%)" value={returnPct} onChange={setReturnPct} />
        <Field label="국내 택배 (₩)" value={domesticShip} onChange={setDomesticShip} />
        <Field label="판매가 (₩)" value={price} onChange={setPrice} highlight />
      </div>

      {result === null ? (
        <p className="mt-4 rounded-md bg-navy-50/50 p-3 text-xs text-navy-500">
          {isDomestic ? '원가(₩)와 판매가를' : '1688 단가(¥)와 판매가를'} 입력하면 실마진이
          계산됩니다. 판매가는 쿠팡 1페이지 중간값이 자동 입력됩니다.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {/* 핵심 결과 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <ResultTile
              label="입고원가"
              value={`₩ ${Math.round(result.landed).toLocaleString('ko-KR')}`}
              sub={
                isDomestic
                  ? undefined
                  : `관세 ${Math.round(result.duty).toLocaleString('ko-KR')} + 부가세 ${Math.round(result.vat).toLocaleString('ko-KR')}`
              }
            />
            <ResultTile
              label="판매 비용"
              value={`₩ ${Math.round(result.fees).toLocaleString('ko-KR')}`}
              sub="수수료+광고+반품+택배"
            />
            <ResultTile
              label="실마진"
              value={`₩ ${Math.round(result.margin).toLocaleString('ko-KR')}`}
              sub={`${result.marginPct.toFixed(1)}%`}
              badge={verdict ?? undefined}
            />
            <ResultTile
              label="손익분기가"
              value={
                result.breakeven !== null
                  ? `₩ ${Math.round(result.breakeven).toLocaleString('ko-KR')}`
                  : '—'
              }
              sub="이 밑으로 팔면 적자"
            />
          </div>

          {/* 시장 가격대별 시나리오 */}
          {result.scenarios.some((s) => s !== null) && (
            <div className="rounded-md border border-navy-100 bg-navy-50/30 p-2">
              <div className="text-[10px] font-semibold uppercase text-navy-500">
                쿠팡 1페이지 가격대별 마진
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                {(['최저가', '중간값', '최고가'] as const).map((label, i) => {
                  const s = result.scenarios[i];
                  return (
                    <div key={label}>
                      <span className="text-navy-400">{label}</span>{' '}
                      {s === null || s === undefined ? (
                        <span className="text-navy-300">—</span>
                      ) : (
                        <span
                          className={
                            s.pct >= 30
                              ? 'font-semibold text-emerald-700'
                              : s.pct >= 15
                                ? 'font-semibold text-amber-700'
                                : 'font-semibold text-red-700'
                          }
                        >
                          {s.pct.toFixed(0)}%
                          <span className="ml-1 font-normal text-navy-500">
                            (₩{Math.round(s.margin).toLocaleString('ko-KR')})
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-navy-400">
            관세율은 품목별로 다릅니다 (생활용품 평균 8%, 일부 0~13%). 정확한 세율은 관세청
            HS코드 조회로 확인하세요. 150달러 이하 직구(목록통관)는 관부가세 면제지만 판매
            목적 수입은 정식 통관 대상입니다.
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight?: boolean;
}

function Field({ label, value, onChange, highlight }: FieldProps) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-navy-500">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-0.5 w-full rounded border px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-teal-500 ${
          highlight ? 'border-teal-300 bg-teal-50/40' : 'border-navy-200'
        }`}
      />
    </label>
  );
}

interface ResultTileProps {
  label: string;
  value: string;
  sub?: string | undefined;
  badge?: { label: string; color: string } | undefined;
}

function ResultTile({ label, value, sub, badge }: ResultTileProps) {
  return (
    <div className="rounded-md border border-navy-100 bg-navy-50/30 p-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-navy-500">
        {label}
        {badge && (
          <span className={`rounded px-1 text-[9px] font-bold ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold text-navy-900">{value}</div>
      {sub && <div className="text-[9px] text-navy-400">{sub}</div>}
    </div>
  );
}
