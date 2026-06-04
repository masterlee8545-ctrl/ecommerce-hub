/**
 * 상품 ↔ 농가 자동 매칭 알고리즘
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2번 PR
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 가중치), §1 P-4/P-5 (멀티테넌트)
 * ADR: ADR-012 D-2 (supply_type='domestic_vendor' 일 때만 호출)
 *
 * 알고리즘:
 *   1. 상품명 + primary_keyword 에서 1차 농산물 키워드 추출 (extractAllKeywords)
 *   2. vendor_products 테이블에서 그 키워드 매칭된 vendor_id 수집
 *   3. vendors.product_keywords_all 텍스트에도 부분 일치 검색 (사이소 데이터 보완)
 *   4. 각 vendor 별 점수 산정:
 *      - 품목 정확 일치: 50점 (vendor_products 에 동일 라벨)
 *      - 품목 부분 일치: 30점 (텍스트 ILIKE)
 *      - 시즌 적합: 20점 (season_peak_month 가 현재 ±2개월)
 *      - 활성도 (also_listed_on): 15점 (3개 이상 몰)
 *      - 지역 일치: 10점 (상품 메타에 지역 있을 때 — 향후)
 *      - 사업자 확인: 5점 (biz_no_confidence='confirmed')
 *   5. 점수 정렬 + 후보 풀에 INSERT (product_vendor_candidates)
 */
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { vendorProducts, vendors, type Vendor } from '@/db';

import { extractAllKeywords } from './keywords';

// ───────────────────────────────────────────────────────────
// 점수 가중치 (운영하면서 튜닝)
// ───────────────────────────────────────────────────────────

export const WEIGHTS = {
  EXACT_MATCH: 50, //                품목 정확 일치 (vendor_products row)
  PARTIAL_MATCH: 30, //              품목 부분 일치 (텍스트 ILIKE)
  SEASON_FIT: 20, //                 시즌 적합 (피크월 ±2)
  MULTI_MALL: 15, //                 also_listed_on 3개 이상
  REGION_MATCH: 10, //               지역 일치 (상품 메타 있을 때)
  BIZ_CONFIRMED: 5, //               사업자 확인됨
} as const;

const TOP_K = 50; //                 후보 최대 개수

// ───────────────────────────────────────────────────────────
// 타입
// ───────────────────────────────────────────────────────────

export interface MatchInput {
  /** 상품명 (자유 텍스트) */
  productName: string;
  /** primary_keyword (선택, 시즌 펄스 담기 시 들어옴) */
  primaryKeyword?: string | null;
  /** 시즌 피크월 (1~12, 선택) — 현재 ±2 안이면 시즌 적합 가산 */
  seasonPeakMonth?: number | null;
  /** 시즌 준비월 (1~12, 선택) — 현재 ±1 안이면 시즌 적합 가산 */
  seasonPrepMonth?: number | null;
  /** 상품 지역 메타 (예: "영천") — 있으면 vendor.biz_address ILIKE 가산 */
  region?: string | null;
  /** 한도 (기본 50) */
  limit?: number;
}

export interface MatchResult {
  vendor: Vendor;
  score: number;
  reasons: string[];
  /** 매칭된 1차 농산물 키워드 (디버깅용) */
  matchedKeywords: string[];
}

// ───────────────────────────────────────────────────────────
// 1) 키워드 매칭된 vendor_id 수집
// ───────────────────────────────────────────────────────────

interface KeywordHit {
  vendor_id: string;
  keyword: string;
  source: 'exact' | 'partial';
}

async function findVendorIdsByKeywords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  keywords: string[],
): Promise<KeywordHit[]> {
  if (keywords.length === 0) return [];

  // (a) vendor_products 정확 일치
  const exactHits = (await tx
    .select({
      vendor_id: vendorProducts.vendor_id,
      keyword: vendorProducts.product_keyword,
    })
    .from(vendorProducts)
    .where(inArray(vendorProducts.product_keyword, keywords))) as Array<{
    vendor_id: string;
    keyword: string;
  }>;

  // (b) vendors.product_keywords_all + biz_sector 텍스트 부분 일치
  //     사이소 데이터 보완 — sello CSV 의 productKeywordsAll 가 거의 비어있고
  //     대신 biz_sector 에 "참외", "복숭아농사", "포도" 같은 품목 텍스트가 있음
  const orClauses = keywords.flatMap((k) => [
    ilike(vendors.product_keywords_all, `%${k}%`),
    ilike(vendors.biz_sector, `%${k}%`),
  ]);
  const partialHits = (await tx
    .select({
      vendor_id: vendors.id,
      keywords_text: vendors.product_keywords_all,
      sector_text: vendors.biz_sector,
    })
    .from(vendors)
    .where(or(...orClauses))) as Array<{
    vendor_id: string;
    keywords_text: string | null;
    sector_text: string | null;
  }>;

  // 정확 일치 결과를 우선 set 에 등록
  const exactVendorIds = new Set(exactHits.map((h) => h.vendor_id));
  const hits: KeywordHit[] = exactHits.map((h) => ({
    vendor_id: h.vendor_id,
    keyword: h.keyword,
    source: 'exact' as const,
  }));

  // 부분 일치 — 정확 일치에 안 잡힌 vendor 만 추가
  for (const p of partialHits) {
    if (exactVendorIds.has(p.vendor_id)) continue;
    const combinedText = `${p.keywords_text ?? ''} ${p.sector_text ?? ''}`;
    const matchedKw = keywords.find((k) => combinedText.includes(k));
    if (matchedKw) {
      hits.push({
        vendor_id: p.vendor_id,
        keyword: matchedKw,
        source: 'partial' as const,
      });
    }
  }

  return hits;
}

// ───────────────────────────────────────────────────────────
// 2) 시즌 적합도
// ───────────────────────────────────────────────────────────

/**
 * 현재 월 기준으로 상품의 시즌 메타가 가까운지 판단.
 *
 * 규칙:
 *   - 현재 월이 prep_month ±1 안이면 적합 (소싱 준비 시기)
 *   - 현재 월이 peak_month ±2 안이면 적합 (피크 직전/직후)
 *   - 둘 다 해당 안 되면 부적합
 */
function isSeasonFit(
  currentMonth: number,
  peakMonth: number | null | undefined,
  prepMonth: number | null | undefined,
): boolean {
  if (prepMonth != null) {
    const diff = Math.min(
      Math.abs(currentMonth - prepMonth),
      12 - Math.abs(currentMonth - prepMonth),
    );
    if (diff <= 1) return true;
  }
  if (peakMonth != null) {
    const diff = Math.min(
      Math.abs(currentMonth - peakMonth),
      12 - Math.abs(currentMonth - peakMonth),
    );
    if (diff <= 2) return true;
  }
  return false;
}

// ───────────────────────────────────────────────────────────
// 3) 점수 산정
// ───────────────────────────────────────────────────────────

interface ScoreInput {
  vendor: Vendor;
  /** 그 vendor 가 가진 매칭 키워드 정보 */
  hits: KeywordHit[];
  seasonFit: boolean;
  region?: string | null | undefined;
}

function scoreVendor(input: ScoreInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. 키워드 일치 — exact 우선, 없으면 partial
  const hasExact = input.hits.some((h) => h.source === 'exact');
  const hasPartial = input.hits.some((h) => h.source === 'partial');
  if (hasExact) {
    score += WEIGHTS.EXACT_MATCH;
    const exactKeywords = input.hits.filter((h) => h.source === 'exact').map((h) => h.keyword);
    reasons.push(`품목 정확 일치 (${[...new Set(exactKeywords)].join(', ')})`);
  } else if (hasPartial) {
    score += WEIGHTS.PARTIAL_MATCH;
    const partialKeywords = input.hits.filter((h) => h.source === 'partial').map((h) => h.keyword);
    reasons.push(`품목 부분 일치 (${[...new Set(partialKeywords)].join(', ')})`);
  }

  // 2. 시즌 적합
  if (input.seasonFit) {
    score += WEIGHTS.SEASON_FIT;
    reasons.push('시즌 적합');
  }

  // 3. 활성도 (also_listed_on 3개 이상)
  const mallCount = input.vendor.also_listed_on.length;
  if (mallCount >= 3) {
    score += WEIGHTS.MULTI_MALL;
    reasons.push(`다중 입점 (${mallCount + 1}개 몰)`);
  } else if (mallCount >= 1) {
    score += Math.floor(WEIGHTS.MULTI_MALL / 2);
    reasons.push(`복수 입점 (${mallCount + 1}개 몰)`);
  }

  // 4. 지역 일치
  if (input.region && input.vendor.biz_address) {
    if (input.vendor.biz_address.includes(input.region)) {
      score += WEIGHTS.REGION_MATCH;
      reasons.push(`지역 일치 (${input.region})`);
    }
  }

  // 5. 사업자 확인
  if (input.vendor.biz_no_confidence === 'confirmed') {
    score += WEIGHTS.BIZ_CONFIRMED;
    reasons.push('사업자 확인');
  }

  return { score, reasons };
}

// ───────────────────────────────────────────────────────────
// 4) 메인 진입점
// ───────────────────────────────────────────────────────────

/**
 * 상품에 적합한 농가 자동 매칭.
 *
 * @param tx withCompanyContext() 가 전달한 트랜잭션 핸들 (RLS 적용됨)
 * @param input 상품 메타
 * @returns 점수순 정렬된 매칭 결과 (최대 limit 개)
 */
export async function matchVendorsForProduct(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  input: MatchInput,
): Promise<MatchResult[]> {
  const limit = input.limit ?? TOP_K;

  // 1) 상품명/primary_keyword 에서 키워드 추출
  const sourceText = [input.productName, input.primaryKeyword ?? ''].filter(Boolean).join(' ');
  const { combined: keywords } = extractAllKeywords(sourceText);

  if (keywords.length === 0) {
    // 키워드 매칭 실패 — 빈 결과
    return [];
  }

  // 2) 키워드 매칭된 vendor_id 수집
  const hits = await findVendorIdsByKeywords(tx, keywords);
  if (hits.length === 0) return [];

  // 3) vendor 정보 조회 (한 번에)
  const uniqVendorIds = [...new Set(hits.map((h) => h.vendor_id))];
  const vendorsList = (await tx
    .select()
    .from(vendors)
    .where(inArray(vendors.id, uniqVendorIds))) as Vendor[];

  const vendorMap = new Map(vendorsList.map((v) => [v.id, v]));

  // 4) vendor 별 hits 그룹화
  const hitsPerVendor = new Map<string, KeywordHit[]>();
  for (const h of hits) {
    const arr = hitsPerVendor.get(h.vendor_id) ?? [];
    arr.push(h);
    hitsPerVendor.set(h.vendor_id, arr);
  }

  // 5) 시즌 적합 판단 (현재 월 + 상품 메타)
  const currentMonth = new Date().getMonth() + 1; // 1~12
  const seasonFit =
    input.seasonPeakMonth != null || input.seasonPrepMonth != null
      ? isSeasonFit(currentMonth, input.seasonPeakMonth, input.seasonPrepMonth)
      : false;

  // 6) 각 vendor 점수 산정
  const results: MatchResult[] = [];
  for (const vendorId of uniqVendorIds) {
    const vendor = vendorMap.get(vendorId);
    if (!vendor) continue;
    const vendorHits = hitsPerVendor.get(vendorId) ?? [];

    const { score, reasons } = scoreVendor({
      vendor,
      hits: vendorHits,
      seasonFit,
      region: input.region,
    });

    if (score === 0) continue;

    results.push({
      vendor,
      score,
      reasons,
      matchedKeywords: [...new Set(vendorHits.map((h) => h.keyword))],
    });
  }

  // 7) 점수순 정렬
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// 사용하지 않는 import 경고 회피
void and;
void eq;
void sql;
