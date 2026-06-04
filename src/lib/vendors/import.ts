/**
 * 농가 CSV 임포트 로직
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-2/P-3/P-4/P-5
 * ADR: ADR-012, ADR-013
 *
 * 처리 흐름:
 *   1. CSV 텍스트 파싱 (csv-parse.ts)
 *   2. 헤더 자동 감지 (csv-headers.ts)
 *   3. 행 단위 정규화 (사업자번호, 전화번호, 다중값 등)
 *   4. dedup 매칭 (사업자번호 → name+address → name+rep)
 *   5. preview 결과 또는 confirm 트랜잭션 실행
 *
 * 멀티테넌트:
 *   - 모든 INSERT/UPDATE 는 withCompanyContext() 내부에서 실행
 *   - 회사 안에서 (company_id, slug) 가 unique
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { vendorProducts, vendors, type NewVendor, type Vendor } from '@/db';

import {
  analyzeHeaders,
  detectHeaders,
  validateRequiredHeaders,
  type StandardField,
} from './csv-headers';
import { parseCsv } from './csv-parse';

// ───────────────────────────────────────────────────────────
// 타입
// ───────────────────────────────────────────────────────────

/** CSV 한 줄을 정규화한 결과 */
export interface NormalizedRow {
  // 식별
  site: string; //                     '사이소-별빛촌장터(영천)'
  slug: string; //                     'saylily12'
  biz_name: string;
  biz_no: string | null; //            정규화 (-, 공백 제거, 10자리)
  biz_no_confidence: 'confirmed' | 'estimated' | 'unknown';

  // 대표
  biz_owner_name: string | null;
  repr_tel_no: string | null;
  biz_mobile: string | null;
  contact_confidence: 'confirmed' | 'estimated' | 'unknown';

  // 주소
  biz_address: string | null;
  biz_zip: string | null;

  // 업종
  biz_type: string | null;
  biz_sector: string | null;

  // 분류
  classification: string | null;
  classification_basis: string | null;

  // 상품 메타
  product_count: number;
  product_keywords_all: string | null;
  products_top10: string | null;

  // 기타
  url: string | null;
  rpers_birthdt: string | null; //     'YYYY-MM-DD' 문자열 (DB date 컬럼에 캐스팅됨)
  rpers_gender: string | null;
  intro_html: string | null;

  // 메모 — UI 표시용
  rawIndex: number; //                 CSV 의 원래 row 번호 (1-based, header 제외)
  validationErrors: string[]; //       이 row 의 검증 문제 (있어도 import 는 진행, 신뢰도 다운그레이드)
}

/** dedup 매칭 결과 */
export interface DedupMatch {
  /** 'biz_no' | 'name+address' | 'name+rep' | 'new' */
  matchKind: 'biz_no' | 'name+address' | 'name+rep' | 'new';
  /** 기존 vendor (matchKind != 'new' 인 경우만) */
  existingVendor?: Vendor | undefined;
}

/** 한 row 의 임포트 액션 */
export interface RowAction {
  rawIndex: number;
  source_site: string;
  biz_name: string;
  biz_no: string | null;
  match: DedupMatch;
  /** 신규 row 데이터 (matchKind='new' 일 때 INSERT 됨) */
  insertPayload?: NewVendor | undefined;
  /** 업데이트 시 추가될 also_listed_on 항목 */
  alsoListedOn?: string | undefined;
  /** vendor_products INSERT 용 키워드 (콤마 분해) */
  keywords: string[];
  /** validation 오류 (UI 표시용) */
  errors: string[];
}

/** 전체 임포트 결과 (preview / confirm 공통) */
export interface ImportResult {
  /** 인식된 헤더 분석 */
  headerAnalysis: ReturnType<typeof analyzeHeaders>;
  /** 모든 row 액션 (UI 미리보기) */
  rows: RowAction[];
  /** 통계 */
  stats: {
    total: number;
    new: number; //                    신규 INSERT
    updated: number; //                기존 row 의 also_listed_on UPDATE
    skipped: number; //                필수값 누락 등으로 스킵
    matchedByBizNo: number;
    matchedByNameAddress: number;
    matchedByNameRep: number;
  };
}

// ───────────────────────────────────────────────────────────
// 정규화 헬퍼
// ───────────────────────────────────────────────────────────

/**
 * 사업자번호 정규화.
 * - 입력: '123-45-67890', '1234567890', '580817-1721018' (주민번호 패턴 — 무효)
 * - 출력: '1234567890' 형태 (10자리). 무효면 null.
 *
 * 검증 (간단):
 * - 숫자만 남기고 10자리이면 OK
 * - 13자리 (주민번호) 는 사업자번호 X → null (사이소 데이터에서 발견됨)
 * - 모두 0 또는 '0000000000' 같은 더미는 null
 */
export function normalizeBizNo(raw: string | null | undefined): {
  bizNo: string | null;
  confidence: 'confirmed' | 'estimated' | 'unknown';
} {
  if (!raw) return { bizNo: null, confidence: 'unknown' };
  const digits = raw.replace(/[^0-9]/g, '');

  // 13자리 = 주민번호 패턴, 사업자번호 X
  if (digits.length === 13) {
    return { bizNo: null, confidence: 'unknown' };
  }

  if (digits.length !== 10) {
    return { bizNo: null, confidence: 'unknown' };
  }

  // 더미 패턴 거부
  if (/^0+$/.test(digits) || digits === '0000000000') {
    return { bizNo: null, confidence: 'unknown' };
  }

  return { bizNo: digits, confidence: 'confirmed' };
}

/**
 * 전화번호 정규화.
 * 입력 그대로 받되 공백/괄호 단순화.
 */
export function normalizePhone(raw: string | null | undefined): {
  phone: string | null;
  confidence: 'confirmed' | 'estimated' | 'unknown';
} {
  if (!raw) return { phone: null, confidence: 'unknown' };
  const trimmed = raw.trim();
  if (!trimmed) return { phone: null, confidence: 'unknown' };

  // 너무 짧으면 의심
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 7) {
    return { phone: trimmed, confidence: 'unknown' };
  }

  return { phone: trimmed, confidence: 'confirmed' };
}

/**
 * 빈 문자열 → null.
 */
function emptyToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/**
 * 정수 파싱. 실패 시 0.
 */
function toInt(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 날짜 정규화: 'YYYY-MM-DD' 형식이면 그대로, 'YYYY.MM.DD' 등은 변환, 그 외는 null.
 * 1899-12-29 같은 명백한 더미는 null.
 */
function normalizeBirthdt(raw: string | null | undefined): string | null {
  const v = emptyToNull(raw);
  if (!v) return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    const year = parseInt(m[1]!, 10);
    // 명백한 더미 거부 (1899-12-29 등)
    if (year < 1920) return null;
    return v;
  }

  // YYYY.MM.DD / YYYY/MM/DD
  m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(v);
  if (m) {
    const year = parseInt(m[1]!, 10);
    if (year < 1920) return null;
    return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  }

  return null;
}

/**
 * 콤마 구분 키워드 분해. 빈 항목/중복 제거.
 */
export function splitKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const set = new Set<string>();
  for (const part of raw.split(/[,;|]/)) {
    const t = part.trim();
    if (t.length > 0 && t.length <= 50) {
      set.add(t);
    }
  }
  return [...set];
}

// ───────────────────────────────────────────────────────────
// 1) row 정규화
// ───────────────────────────────────────────────────────────

function getCell(
  row: string[],
  map: Partial<Record<StandardField, number>>,
  field: StandardField,
): string | null {
  const idx = map[field];
  if (idx === undefined) return null;
  return emptyToNull(row[idx]);
}

export function normalizeRow(
  row: string[],
  map: Partial<Record<StandardField, number>>,
  rawIndex: number,
): NormalizedRow {
  const errors: string[] = [];

  const site = getCell(row, map, 'site') ?? '';
  const slug = getCell(row, map, 'slug') ?? '';
  const biz_name = getCell(row, map, 'biz_name') ?? '';

  if (!site) errors.push('site 누락');
  if (!slug) errors.push('slug 누락');
  if (!biz_name) errors.push('biz_name 누락');

  const bizNoResult = normalizeBizNo(getCell(row, map, 'biz_no'));
  const reprResult = normalizePhone(getCell(row, map, 'repr_tel_no'));
  const mobileResult = normalizePhone(getCell(row, map, 'biz_mobile'));

  // 연락처 신뢰도 = 두 번호 중 가장 높은 거
  const contactConfidence =
    reprResult.confidence === 'confirmed' || mobileResult.confidence === 'confirmed'
      ? 'confirmed'
      : reprResult.phone || mobileResult.phone
        ? 'estimated'
        : 'unknown';

  return {
    site,
    slug,
    biz_name,
    biz_no: bizNoResult.bizNo,
    biz_no_confidence: bizNoResult.confidence,
    biz_owner_name: getCell(row, map, 'biz_owner_name'),
    repr_tel_no: reprResult.phone,
    biz_mobile: mobileResult.phone,
    contact_confidence: contactConfidence,
    biz_address: getCell(row, map, 'biz_address'),
    biz_zip: getCell(row, map, 'biz_zip'),
    biz_type: getCell(row, map, 'biz_type'),
    biz_sector: getCell(row, map, 'biz_sector'),
    classification: getCell(row, map, 'classification'),
    classification_basis: getCell(row, map, 'classification_basis'),
    product_count: toInt(getCell(row, map, 'product_count')),
    product_keywords_all: getCell(row, map, 'product_keywords_all'),
    products_top10: getCell(row, map, 'products_top10'),
    url: getCell(row, map, 'url'),
    rpers_birthdt: normalizeBirthdt(getCell(row, map, 'rpers_birthdt')),
    rpers_gender: getCell(row, map, 'rpers_gender'),
    intro_html: getCell(row, map, 'seller_intro_cont'),
    rawIndex,
    validationErrors: errors,
  };
}

// ───────────────────────────────────────────────────────────
// 2) dedup 매칭
// ───────────────────────────────────────────────────────────

/**
 * 같은 회사 내 기존 vendors 중에서 매칭 찾기.
 *
 * 매칭 우선순위:
 *   1. biz_no 정확 일치 (가장 신뢰)
 *   2. biz_name + biz_address 정확 일치
 *   3. biz_name + biz_owner_name 정확 일치
 *
 * 입력: 정규화된 CSV row 들
 * 출력: 각 row 별 match 결과
 */
export interface DedupContext {
  byBizNo: Map<string, Vendor>;
  byNameAddress: Map<string, Vendor>;
  byNameRep: Map<string, Vendor>;
  byCompanySlug: Map<string, Vendor>;
}

export function buildDedupContext(existing: Vendor[]): DedupContext {
  const byBizNo = new Map<string, Vendor>();
  const byNameAddress = new Map<string, Vendor>();
  const byNameRep = new Map<string, Vendor>();
  const byCompanySlug = new Map<string, Vendor>();

  for (const v of existing) {
    if (v.biz_no) byBizNo.set(v.biz_no, v);
    if (v.biz_name && v.biz_address) {
      byNameAddress.set(`${v.biz_name}|${v.biz_address}`, v);
    }
    if (v.biz_name && v.biz_owner_name) {
      byNameRep.set(`${v.biz_name}|${v.biz_owner_name}`, v);
    }
    byCompanySlug.set(v.slug, v);
  }

  return { byBizNo, byNameAddress, byNameRep, byCompanySlug };
}

export function matchVendor(row: NormalizedRow, ctx: DedupContext): DedupMatch {
  // 같은 slug 가 이미 있는 회사 = 동일 row 재임포트 (UPDATE)
  const slugMatch = ctx.byCompanySlug.get(row.slug);
  if (slugMatch && slugMatch.source_site === row.site) {
    // 같은 출처에서 같은 slug 가 또 들어옴 → 같은 row
    return { matchKind: 'biz_no', existingVendor: slugMatch };
  }

  if (row.biz_no) {
    const m = ctx.byBizNo.get(row.biz_no);
    if (m) return { matchKind: 'biz_no', existingVendor: m };
  }

  if (row.biz_address) {
    const key = `${row.biz_name}|${row.biz_address}`;
    const m = ctx.byNameAddress.get(key);
    if (m) return { matchKind: 'name+address', existingVendor: m };
  }

  if (row.biz_owner_name) {
    const key = `${row.biz_name}|${row.biz_owner_name}`;
    const m = ctx.byNameRep.get(key);
    if (m) return { matchKind: 'name+rep', existingVendor: m };
  }

  return { matchKind: 'new' };
}

// ───────────────────────────────────────────────────────────
// 3) preview 빌드
// ───────────────────────────────────────────────────────────

export function buildRowActions(
  rows: NormalizedRow[],
  ctx: DedupContext,
  companyId: string,
  createdBy: string | null,
): RowAction[] {
  const actions: RowAction[] = [];

  // CSV 내 그룹화 — 같은 vendor 가 여러 site/slug 로 나타나는 경우 첫 row 가 INSERT 됨
  const intraBatchBizNo = new Map<string, RowAction>(); //   같은 사업자번호 → 첫 row
  const intraBatchSlug = new Map<string, RowAction>(); //    같은 slug → 첫 row (사이소 같은 셀러가 여러 몰에 입점)

  for (const row of rows) {
    // 필수값 누락 → 스킵
    if (row.validationErrors.length > 0) {
      actions.push({
        rawIndex: row.rawIndex,
        source_site: row.site,
        biz_name: row.biz_name,
        biz_no: row.biz_no,
        match: { matchKind: 'new' },
        keywords: splitKeywords(row.product_keywords_all),
        errors: row.validationErrors,
      });
      continue;
    }

    // ① CSV 안에서 같은 slug 가 이미 INSERT 그룹의 첫번째로 등록되어 있음 → also_listed_on 추가
    //    사이소 셀러가 여러 cyso 서브몰에 입점한 경우 (예: saylily12 가 별빛촌장터·경주몰 둘 다)
    const slugFirst = intraBatchSlug.get(row.slug);
    if (slugFirst) {
      // 첫 row 와 site 가 다르면 also_listed_on 에 추가 (같은 site 면 그냥 중복 skip)
      const sameSite = slugFirst.insertPayload?.source_site === row.site;
      if (!sameSite) {
        // 첫번째 row 의 insertPayload 에 also_listed_on 직접 추가
        if (slugFirst.insertPayload) {
          const current = slugFirst.insertPayload.also_listed_on ?? [];
          const arr = Array.isArray(current) ? current : [];
          if (!arr.includes(row.site)) {
            slugFirst.insertPayload = {
              ...slugFirst.insertPayload,
              also_listed_on: [...arr, row.site],
            };
          }
        }
        actions.push({
          rawIndex: row.rawIndex,
          source_site: row.site,
          biz_name: row.biz_name,
          biz_no: row.biz_no,
          match: { matchKind: 'biz_no' }, // 그룹 내 매칭
          alsoListedOn: row.site, // 통계용
          keywords: splitKeywords(row.product_keywords_all),
          errors: [],
        });
      } else {
        // 정확히 같은 (site, slug) 가 중복 — 데이터 이상, 스킵
        actions.push({
          rawIndex: row.rawIndex,
          source_site: row.site,
          biz_name: row.biz_name,
          biz_no: row.biz_no,
          match: { matchKind: 'biz_no' },
          keywords: splitKeywords(row.product_keywords_all),
          errors: ['CSV 내 같은 (site, slug) 중복'],
        });
      }
      continue;
    }

    // ② 기존 DB 와 매칭
    const match = matchVendor(row, ctx);

    // ③ CSV 안에서 사업자번호 중복 (다른 slug) → 그룹의 첫번째에 also_listed_on 추가
    if (match.matchKind === 'new' && row.biz_no) {
      const intra = intraBatchBizNo.get(row.biz_no);
      if (intra && intra.insertPayload) {
        const current = intra.insertPayload.also_listed_on ?? [];
        const arr = Array.isArray(current) ? current : [];
        if (intra.insertPayload.source_site !== row.site && !arr.includes(row.site)) {
          intra.insertPayload = {
            ...intra.insertPayload,
            also_listed_on: [...arr, row.site],
          };
        }
        actions.push({
          rawIndex: row.rawIndex,
          source_site: row.site,
          biz_name: row.biz_name,
          biz_no: row.biz_no,
          match: { matchKind: 'biz_no' },
          alsoListedOn: row.site,
          keywords: splitKeywords(row.product_keywords_all),
          errors: [],
        });
        continue;
      }
    }

    if (match.matchKind === 'new') {
      // 신규 INSERT 페이로드
      const payload: NewVendor = {
        company_id: companyId,
        slug: row.slug,
        biz_name: row.biz_name,
        biz_no: row.biz_no,
        biz_no_confidence: row.biz_no_confidence,
        biz_owner_name: row.biz_owner_name,
        repr_tel_no: row.repr_tel_no,
        biz_mobile: row.biz_mobile,
        contact_confidence: row.contact_confidence,
        biz_address: row.biz_address,
        biz_zip: row.biz_zip,
        biz_type: row.biz_type,
        biz_sector: row.biz_sector,
        classification: row.classification,
        classification_basis: row.classification_basis,
        product_count: row.product_count,
        product_keywords_all: row.product_keywords_all,
        products_top10: row.products_top10,
        source_site: row.site,
        also_listed_on: [],
        source_url: row.url,
        rpers_birthdt: row.rpers_birthdt,
        rpers_gender: row.rpers_gender,
        intro_html: row.intro_html,
        created_by: createdBy,
      };

      const action: RowAction = {
        rawIndex: row.rawIndex,
        source_site: row.site,
        biz_name: row.biz_name,
        biz_no: row.biz_no,
        match,
        insertPayload: payload,
        keywords: splitKeywords(row.product_keywords_all),
        errors: [],
      };

      // 그룹 첫번째로 등록 (이후 같은 slug / biz_no 가 나오면 also_listed_on 추가)
      if (row.biz_no) intraBatchBizNo.set(row.biz_no, action);
      intraBatchSlug.set(row.slug, action);

      actions.push(action);
    } else {
      // 기존 row 에 also_listed_on 추가
      const existing = match.existingVendor!;
      const newSite = row.site !== existing.source_site ? row.site : undefined;
      actions.push({
        rawIndex: row.rawIndex,
        source_site: row.site,
        biz_name: row.biz_name,
        biz_no: row.biz_no,
        match,
        alsoListedOn: newSite,
        keywords: splitKeywords(row.product_keywords_all),
        errors: [],
      });
    }
  }

  return actions;
}

// ───────────────────────────────────────────────────────────
// 4) 통계 산출
// ───────────────────────────────────────────────────────────

export function summarize(actions: RowAction[]): ImportResult['stats'] {
  let newCount = 0;
  let updated = 0;
  let skipped = 0;
  let byBizNo = 0;
  let byNameAddress = 0;
  let byNameRep = 0;

  for (const a of actions) {
    if (a.errors.length > 0) {
      skipped++;
      continue;
    }
    if (a.match.matchKind === 'new') {
      newCount++;
    } else {
      updated++;
      if (a.match.matchKind === 'biz_no') byBizNo++;
      else if (a.match.matchKind === 'name+address') byNameAddress++;
      else if (a.match.matchKind === 'name+rep') byNameRep++;
    }
  }

  return {
    total: actions.length,
    new: newCount,
    updated,
    skipped,
    matchedByBizNo: byBizNo,
    matchedByNameAddress: byNameAddress,
    matchedByNameRep: byNameRep,
  };
}

// ───────────────────────────────────────────────────────────
// 5) preview 진입점
// ───────────────────────────────────────────────────────────

export async function previewImport(opts: {
  csvText: string;
  companyId: string;
  createdBy: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
}): Promise<ImportResult & { headerError?: string }> {
  const parsed = parseCsv(opts.csvText);
  const headerAnalysis = analyzeHeaders(parsed.headers);

  const map = detectHeaders(parsed.headers);
  const validation = validateRequiredHeaders(map);

  if (!validation.ok) {
    return {
      headerAnalysis,
      rows: [],
      stats: {
        total: 0,
        new: 0,
        updated: 0,
        skipped: 0,
        matchedByBizNo: 0,
        matchedByNameAddress: 0,
        matchedByNameRep: 0,
      },
      headerError: `필수 헤더 누락: ${validation.missing.join(', ')}`,
    };
  }

  // CSV 행 정규화
  const normalized = parsed.rows.map((r, i) => normalizeRow(r, map, i + 1));

  // 같은 회사의 기존 vendors 모두 조회 (dedup 컨텍스트)
  const existing = await opts.tx
    .select()
    .from(vendors)
    .where(eq(vendors.company_id, opts.companyId));

  const ctx = buildDedupContext(existing);
  const actions = buildRowActions(normalized, ctx, opts.companyId, opts.createdBy);
  const stats = summarize(actions);

  return { headerAnalysis, rows: actions, stats };
}

// ───────────────────────────────────────────────────────────
// 6) confirm — 트랜잭션 INSERT/UPDATE
// ───────────────────────────────────────────────────────────

/**
 * 임포트 확정.
 *
 * 트랜잭션 안에서:
 *   1. 신규 vendors INSERT (배치)
 *   2. 기존 vendors 의 also_listed_on UPDATE
 *   3. vendor_products INSERT (키워드 분해)
 *
 * 호출자가 withCompanyContext() 안에서 호출해야 함 (RLS 강제).
 */
export async function confirmImport(opts: {
  result: ImportResult;
  companyId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
}): Promise<{
  insertedVendors: number;
  updatedVendors: number;
  insertedKeywords: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = opts.tx as any;
  const newPayloads: NewVendor[] = [];
  /** alsoListed 업데이트가 필요한 vendor_id → 추가할 site 목록 */
  const updates = new Map<string, Set<string>>();

  for (const a of opts.result.rows) {
    if (a.errors.length > 0) continue;
    if (a.match.matchKind === 'new' && a.insertPayload) {
      newPayloads.push(a.insertPayload);
    } else if (a.match.existingVendor && a.alsoListedOn) {
      const id = a.match.existingVendor.id;
      const set = updates.get(id) ?? new Set<string>();
      set.add(a.alsoListedOn);
      updates.set(id, set);
    }
  }

  // ── 신규 INSERT ──
  let insertedVendors = 0;
  const insertedIds = new Map<string, string>(); //   `${site}|${slug}` → vendor.id
  if (newPayloads.length > 0) {
    // postgres 의 IN-clause 한계로 chunk 단위 INSERT
    const CHUNK = 500;
    for (let i = 0; i < newPayloads.length; i += CHUNK) {
      const chunk = newPayloads.slice(i, i + CHUNK);
      const inserted = await tx
        .insert(vendors)
        .values(chunk)
        .returning({ id: vendors.id, slug: vendors.slug, source_site: vendors.source_site });
      insertedVendors += inserted.length;
      for (const v of inserted) {
        insertedIds.set(`${v.source_site}|${v.slug}`, v.id);
      }
    }
  }

  // ── 기존 vendor 의 also_listed_on UPDATE ──
  let updatedVendors = 0;
  for (const [vendorId, sites] of updates) {
    if (sites.size === 0) continue;
    // 기존 also_listed_on 가져와서 합쳐서 다시 저장 (배열 union)
    const [existing] = await tx
      .select({ also: vendors.also_listed_on, source_site: vendors.source_site })
      .from(vendors)
      .where(eq(vendors.id, vendorId));
    if (!existing) continue;
    const merged = new Set<string>(existing.also);
    for (const s of sites) {
      // source_site 와 중복되는 건 제외
      if (s !== existing.source_site) merged.add(s);
    }
    if (merged.size !== existing.also.length) {
      await tx
        .update(vendors)
        .set({ also_listed_on: [...merged], updated_at: new Date() })
        .where(eq(vendors.id, vendorId));
      updatedVendors++;
    }
  }

  // ── vendor_products INSERT ──
  // 신규 vendor 의 키워드 + 기존 vendor 에 추가될 키워드 (다른 출처)
  let insertedKeywords = 0;
  const vpRows: Array<{
    company_id: string;
    vendor_id: string;
    product_keyword: string;
    source: string;
    confidence: 'confirmed' | 'estimated' | 'unknown';
  }> = [];

  // 신규 vendor 의 키워드 — 방금 INSERT 한 row 에 매핑
  for (const a of opts.result.rows) {
    if (a.errors.length > 0) continue;
    if (a.match.matchKind === 'new' && a.insertPayload) {
      const id = insertedIds.get(`${a.source_site}|${a.insertPayload.slug}`);
      if (!id) continue;
      for (const kw of a.keywords) {
        vpRows.push({
          company_id: opts.companyId,
          vendor_id: id,
          product_keyword: kw,
          source: `${a.source_site}-productKeywordsAll`,
          confidence: 'estimated',
        });
      }
    } else if (a.match.existingVendor && a.keywords.length > 0) {
      const id = a.match.existingVendor.id;
      for (const kw of a.keywords) {
        vpRows.push({
          company_id: opts.companyId,
          vendor_id: id,
          product_keyword: kw,
          source: `${a.source_site}-productKeywordsAll`,
          confidence: 'estimated',
        });
      }
    }
  }

  if (vpRows.length > 0) {
    // 기존 row 와 unique 충돌 방지: 이미 (vendor_id, product_keyword) 가 있으면 skip
    // ON CONFLICT DO NOTHING 사용. drizzle 의 onConflictDoNothing.
    const CHUNK = 1000;
    for (let i = 0; i < vpRows.length; i += CHUNK) {
      const chunk = vpRows.slice(i, i + CHUNK);
      const ins = await tx
        .insert(vendorProducts)
        .values(chunk)
        .onConflictDoNothing({ target: [vendorProducts.vendor_id, vendorProducts.product_keyword] })
        .returning({ id: vendorProducts.id });
      insertedKeywords += ins.length;
    }
  }

  return { insertedVendors, updatedVendors, insertedKeywords };
}

// 사용하지 않는 import 경고 회피
void and;
void inArray;
void isNotNull;
