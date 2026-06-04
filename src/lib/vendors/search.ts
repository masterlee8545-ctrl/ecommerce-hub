/**
 * 농가 검색 + 단건 조회
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-4/P-5 (멀티테넌트), §1 P-1 (빈 결과 명시)
 */
import { and, count, eq, ilike, or, sql } from 'drizzle-orm';

import { vendors, type Vendor } from '@/db';

export interface VendorListItem {
  id: string;
  slug: string;
  biz_name: string;
  biz_no: string | null;
  biz_no_confidence: string;
  biz_owner_name: string | null;
  repr_tel_no: string | null;
  biz_mobile: string | null;
  biz_address: string | null;
  biz_sector: string | null;
  classification: string | null;
  product_count: number | null;
  product_keywords_all: string | null;
  products_top10: string | null;
  source_site: string;
  also_listed_on: string[];
  work_status: string | null;
  status_note: string | null;
}

export interface VendorListResult {
  items: VendorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchOptions {
  /** 업체명 / 사업자번호 / 주소 부분 일치 */
  query?: string | undefined;
  /** 시·도 / 시·군 부분 일치 (주소 필터) */
  region?: string | undefined;
  /** 1차_농가 등 분류 필터 */
  classification?: string | undefined;
  /** 출처 필터 (예: '사이소-별빛촌장터(영천)') */
  source_site?: string | undefined;
  /** 판매 품목 키워드 부분 일치 (product_keywords_all / products_top10) */
  product_keyword?: string | undefined;
  /** 영업 상태 필터 (active/no_phone/dropped 등) */
  work_status?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * vendors 검색. 모든 쿼리는 RLS 컨텍스트 안에서 실행되어야 함.
 *
 * 호출자: 서버 컴포넌트 또는 API 라우트가 withCompanyContext() 안에서 호출.
 *
 * @param tx withCompanyContext() 가 전달한 트랜잭션 핸들
 */
export async function searchVendors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  opts: SearchOptions,
): Promise<VendorListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const conds = [];

  if (opts.query) {
    const q = `%${opts.query.trim()}%`;
    conds.push(
      or(
        ilike(vendors.biz_name, q),
        ilike(vendors.biz_no, q),
        ilike(vendors.biz_address, q),
        ilike(vendors.biz_owner_name, q),
      ),
    );
  }

  if (opts.region) {
    conds.push(ilike(vendors.biz_address, `%${opts.region.trim()}%`));
  }

  if (opts.classification) {
    conds.push(eq(vendors.classification, opts.classification));
  }

  if (opts.source_site) {
    conds.push(eq(vendors.source_site, opts.source_site));
  }

  if (opts.product_keyword) {
    const k = `%${opts.product_keyword.trim()}%`;
    conds.push(
      or(
        ilike(vendors.product_keywords_all, k),
        ilike(vendors.products_top10, k),
        ilike(vendors.biz_sector, k),
      ),
    );
  }

  if (opts.work_status) {
    conds.push(eq(vendors.work_status, opts.work_status));
  }

  const where = conds.length > 0 ? and(...conds) : undefined;

  // 페이지 데이터
  const items = (await tx
    .select({
      id: vendors.id,
      slug: vendors.slug,
      biz_name: vendors.biz_name,
      biz_no: vendors.biz_no,
      biz_no_confidence: vendors.biz_no_confidence,
      biz_owner_name: vendors.biz_owner_name,
      repr_tel_no: vendors.repr_tel_no,
      biz_mobile: vendors.biz_mobile,
      biz_address: vendors.biz_address,
      biz_sector: vendors.biz_sector,
      classification: vendors.classification,
      product_count: vendors.product_count,
      product_keywords_all: vendors.product_keywords_all,
      products_top10: vendors.products_top10,
      source_site: vendors.source_site,
      also_listed_on: vendors.also_listed_on,
      work_status: vendors.work_status,
      status_note: vendors.status_note,
    })
    .from(vendors)
    .where(where)
    .orderBy(sql`${vendors.product_count} DESC NULLS LAST, ${vendors.biz_name} ASC`)
    .limit(pageSize)
    .offset(offset)) as VendorListItem[];

  // 총 개수
  const totalRows = (await tx
    .select({ c: count() })
    .from(vendors)
    .where(where)) as Array<{ c: number }>;
  const total = totalRows[0]?.c ?? 0;

  return { items, total, page, pageSize };
}

/**
 * 농가 단건 조회.
 */
export async function getVendor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  id: string,
): Promise<Vendor | null> {
  const rows = (await tx.select().from(vendors).where(eq(vendors.id, id)).limit(1)) as Vendor[];
  return rows[0] ?? null;
}
