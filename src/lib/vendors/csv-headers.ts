/**
 * CSV 헤더 자동 감지 + 표준 필드명 매핑
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * 동기:
 *   BUYWISE 크롤링 데이터에 두 가지 헤더 포맷이 공존:
 *   - 영문 (cyso_all_sellers.csv): site, slug, bizName, ...
 *   - 한글 (all_sellers.csv): site, slug, 업체명, ...
 *
 *   임포트 통로는 두 포맷 모두 지원해야 하므로 자동 매핑.
 */

/** vendors 테이블의 표준 필드명 (DB 컬럼 이름 그대로) */
export type StandardField =
  | 'site'
  | 'slug'
  | 'biz_name'
  | 'classification'
  | 'classification_basis'
  | 'biz_owner_name'
  | 'repr_tel_no'
  | 'biz_mobile'
  | 'biz_address'
  | 'biz_no'
  | 'product_count'
  | 'product_keywords_all'
  | 'products_top10'
  | 'url'
  | 'biz_type'
  | 'biz_sector'
  | 'rpers_birthdt'
  | 'rpers_gender'
  | 'biz_zip'
  | 'seller_intro_cont';

/**
 * CSV 원본 헤더 → 표준 필드 매핑 사전.
 * 영문/한글 변종을 모두 커버.
 */
const HEADER_ALIASES: Record<string, StandardField> = {
  // 출처 + 식별
  site: 'site',
  slug: 'slug',

  // 업체명
  bizname: 'biz_name',
  업체명: 'biz_name',

  // 분류
  classification: 'classification',
  분류: 'classification',
  classification_basis: 'classification_basis',
  분류_근거: 'classification_basis',

  // 대표
  bizownername: 'biz_owner_name',
  대표자명: 'biz_owner_name',

  reprtelno: 'repr_tel_no',
  연락처: 'repr_tel_no',

  bizmobile: 'biz_mobile',
  휴대전화: 'biz_mobile',

  // 주소
  bizaddress: 'biz_address',
  주소: 'biz_address',

  // 사업자번호
  bizno: 'biz_no',
  사업자번호: 'biz_no',

  // 상품 메타
  productcount: 'product_count',
  product_count: 'product_count',
  productkeywordsall: 'product_keywords_all',
  product_keywords_all: 'product_keywords_all',
  productstop10: 'products_top10',
  products_top10: 'products_top10',

  // URL
  url: 'url',

  // 사이소 추가 컬럼 (한글 변종은 없음)
  biztype: 'biz_type',
  bizsector: 'biz_sector',
  rpersbirthdt: 'rpers_birthdt',
  rpersgender: 'rpers_gender',
  bizzip: 'biz_zip',
  sellerintrocont: 'seller_intro_cont',
};

/**
 * 헤더 row 를 분석해 (CSV 위치 → 표준 필드) 매핑 만들기.
 * 알 수 없는 헤더는 무시.
 *
 * @param headers parseCsv() 가 반환한 headers 배열
 * @returns 표준 필드명 → CSV 컬럼 인덱스 매핑. 누락된 필드는 undefined.
 */
export function detectHeaders(headers: string[]): Partial<Record<StandardField, number>> {
  const map: Partial<Record<StandardField, number>> = {};

  headers.forEach((raw, idx) => {
    // 소문자 + 공백/언더스코어 정규화로 매칭
    const normalized = raw.toLowerCase().replace(/[\s_-]/g, '');
    const std = HEADER_ALIASES[normalized] ?? HEADER_ALIASES[raw.toLowerCase()];
    if (std !== undefined) {
      map[std] = idx;
    }
  });

  return map;
}

/**
 * 필수 필드 검증.
 * 임포트가 의미를 가지려면 최소한 site, slug, biz_name 은 있어야 함.
 */
export function validateRequiredHeaders(
  map: Partial<Record<StandardField, number>>,
): { ok: true } | { ok: false; missing: StandardField[] } {
  const required: StandardField[] = ['site', 'slug', 'biz_name'];
  const missing = required.filter((f) => map[f] === undefined);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

/**
 * 디버그/UI 표시용: 인식한 필드와 무시한 헤더를 모두 보고.
 */
export interface HeaderAnalysis {
  detected: Array<{ field: StandardField; index: number; csvHeader: string }>;
  ignored: Array<{ index: number; csvHeader: string }>;
  missing: StandardField[];
}

export function analyzeHeaders(headers: string[]): HeaderAnalysis {
  const map = detectHeaders(headers);
  const detected: HeaderAnalysis['detected'] = [];
  const usedIndexes = new Set<number>();

  for (const [field, idx] of Object.entries(map)) {
    if (idx === undefined) continue;
    detected.push({
      field: field as StandardField,
      index: idx,
      csvHeader: headers[idx] ?? '',
    });
    usedIndexes.add(idx);
  }

  const ignored: HeaderAnalysis['ignored'] = [];
  headers.forEach((h, idx) => {
    if (!usedIndexes.has(idx)) {
      ignored.push({ index: idx, csvHeader: h });
    }
  });

  const required: StandardField[] = ['site', 'slug', 'biz_name'];
  const missing = required.filter((f) => map[f] === undefined);

  return { detected, ignored, missing };
}
