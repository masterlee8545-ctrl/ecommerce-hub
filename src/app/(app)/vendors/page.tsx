/**
 * /vendors — 농가 검색 (보조 화면, 메인 진입점은 /products/[id]/find-vendor — 2번 PR)
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트), §1 P-9
 * ADR: ADR-012, ADR-013
 *
 * 역할:
 *   - 업체명 / 사업자번호 / 주소 / 대표자 부분 일치 검색
 *   - 분류 / 출처 필터
 *   - 페이지당 50개
 *   - 회사 격리 (RLS) — 다른 회사 농가 안 보임. 4번 PR 에서 grant 받은 풀 추가.
 */
import Link from 'next/link';

import { ArrowUpRight, Database, FileUp, Search } from 'lucide-react';

import { withCompanyContext } from '@/db';
import { requireCompanyContext } from '@/lib/auth/session';
import { searchVendors } from '@/lib/vendors/search';

import { VendorStatusCell } from './status-cell';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    region?: string;
    classification?: string;
    source_site?: string;
    keyword?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function VendorsPage({ searchParams }: PageProps) {
  const ctx = await requireCompanyContext();
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() ?? '';
  const region = sp.region?.trim() ?? '';
  const classification = sp.classification?.trim() ?? '';
  const sourceSite = sp.source_site?.trim() ?? '';
  const keyword = sp.keyword?.trim() ?? '';
  const status = sp.status?.trim() ?? '';

  let result;
  let dbError: string | null = null;
  try {
    result = await withCompanyContext(ctx.companyId, async (tx) =>
      searchVendors(tx, {
        query: query || undefined,
        region: region || undefined,
        classification: classification || undefined,
        source_site: sourceSite || undefined,
        product_keyword: keyword || undefined,
        work_status: status || undefined,
        page,
        pageSize: 50,
      }),
    );
  } catch (err) {
    console.error('[vendors] 검색 실패:', err);
    dbError = err instanceof Error ? err.message : '검색 실패';
    result = { items: [], total: 0, page, pageSize: 50 };
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-600">
            <Database className="h-5 w-5" aria-hidden />
            농가 마스터
          </div>
          <h1 className="mt-2 text-3xl font-bold text-navy-900">농가 검색</h1>
          <p className="mt-2 text-sm text-navy-500">
            현재 법인에 등록된 농가/공급처 마스터. 상품 페이지의 &ldquo;공급처 찾기&rdquo; 탭에서 이 풀로 자동 매칭됩니다 (2번 PR).
          </p>
        </div>
        <Link
          href="/vendors/import"
          className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          <FileUp className="h-4 w-4" />
          CSV 임포트
        </Link>
      </header>

      {/* 검색 폼 */}
      <form
        method="get"
        action="/vendors"
        className="grid grid-cols-1 gap-3 rounded-lg border border-navy-200 bg-white p-4 md:grid-cols-6"
      >
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-navy-700">
            업체명 / 사업자번호 / 주소
          </label>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="예: 남탑산방, 토마토마"
            className="mt-1 w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-navy-700">
            판매 품목
          </label>
          <input
            type="search"
            name="keyword"
            defaultValue={keyword}
            placeholder="예: 참외, 한우, 사과"
            className="mt-1 w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-navy-700">지역</label>
          <input
            type="text"
            name="region"
            defaultValue={region}
            placeholder="예: 영천"
            className="mt-1 w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-navy-700">분류</label>
          <input
            type="text"
            name="classification"
            defaultValue={classification}
            placeholder="예: 1차_농가"
            className="mt-1 w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-navy-700">영업 상태</label>
            <select
              name="status"
              defaultValue={status}
              className="mt-1 rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              <option value="">전체</option>
              <option value="active">✅ 활성</option>
              <option value="no_phone">📵 번호없음</option>
              <option value="no_answer">☎ 부재중</option>
              <option value="sourcing_failed">💸 소싱실패</option>
              <option value="dropped">🚫 탈락</option>
              <option value="contracted">🤝 거래중</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
          {(query || keyword || region || classification || sourceSite || status) && (
            <Link
              href="/vendors"
              className="rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-600 hover:bg-navy-50"
            >
              초기화
            </Link>
          )}
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-navy-800 px-6 py-2 text-sm font-semibold text-white hover:bg-navy-900"
          >
            <Search className="h-4 w-4" />
            검색
          </button>
          </div>
        </div>

        {sourceSite && (
          <div className="md:col-span-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-navy-200 bg-navy-50 px-3 py-1 text-xs text-navy-600">
              출처: <strong>{sourceSite}</strong>
              <Link href="/vendors" className="text-red-500 hover:underline">
                ✕
              </Link>
            </span>
          </div>
        )}
      </form>

      {/* 결과 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-navy-900">
            검색 결과 <span className="text-sm text-navy-500">총 {result.total.toLocaleString()}건</span>
          </h2>
          {totalPages > 1 && (
            <div className="text-xs text-navy-500">
              {page} / {totalPages} 페이지
            </div>
          )}
        </div>

        {dbError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            오류: {dbError}
          </div>
        )}

        {result.total === 0 && !dbError && (
          <div className="rounded-md border border-dashed border-navy-300 bg-white p-8 text-center">
            <p className="text-base font-medium text-navy-700">
              아직 등록된 농가가 없어요.
            </p>
            <p className="mt-1 text-sm text-navy-500">
              사이소·김제몰 CSV 를 임포트해서 시작하세요.
            </p>
            <Link
              href="/vendors/import"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <FileUp className="h-4 w-4" />
              CSV 임포트로 가기
            </Link>
          </div>
        )}

        {result.items.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-navy-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="px-3 py-2 text-left">업체명</th>
                  <th className="px-3 py-2 text-left">상태/메모</th>
                  <th className="px-3 py-2 text-left">대표자</th>
                  <th className="px-3 py-2 text-left">연락처</th>
                  <th className="px-3 py-2 text-left">판매 품목</th>
                  <th className="px-3 py-2 text-left">주소</th>
                  <th className="px-3 py-2 text-left">분류</th>
                  <th className="px-3 py-2 text-left">출처</th>
                  <th className="px-3 py-2 text-right">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {result.items.map((v) => (
                  <tr key={v.id} className="hover:bg-navy-50/30">
                    <td className="px-3 py-2 font-medium text-navy-900">{v.biz_name}</td>
                    <td className="px-3 py-2">
                      <VendorStatusCell
                        vendorId={v.id}
                        initialStatus={v.work_status ?? 'active'}
                        initialNote={v.status_note}
                      />
                    </td>
                    <td className="px-3 py-2 text-navy-600">{v.biz_owner_name ?? '-'}</td>
                    <td className="px-3 py-2 text-navy-700">
                      <div className="flex flex-col gap-0.5">
                        {v.repr_tel_no ? (
                          <a
                            href={`tel:${v.repr_tel_no.replace(/[^\d+]/g, '')}`}
                            className="font-medium text-blue-600 hover:underline"
                            title="대표 번호"
                          >
                            ☎ {v.repr_tel_no}
                          </a>
                        ) : null}
                        {v.biz_mobile ? (
                          <a
                            href={`tel:${v.biz_mobile.replace(/[^\d+]/g, '')}`}
                            className="font-medium text-emerald-600 hover:underline"
                            title="휴대전화"
                          >
                            📱 {v.biz_mobile}
                          </a>
                        ) : null}
                        {!v.repr_tel_no && !v.biz_mobile && (
                          <span className="text-navy-300">-</span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-navy-700">
                      {v.product_keywords_all || v.products_top10 ? (
                        <div className="space-y-0.5">
                          {v.product_keywords_all && (
                            <div className="line-clamp-2 text-xs leading-tight" title={v.product_keywords_all}>
                              {v.product_keywords_all}
                            </div>
                          )}
                          {v.products_top10 && v.products_top10 !== v.product_keywords_all && (
                            <div className="line-clamp-1 text-xs text-navy-500" title={v.products_top10}>
                              {v.products_top10}
                            </div>
                          )}
                          {v.product_count != null && v.product_count > 0 && (
                            <div className="text-xs text-emerald-600">
                              총 {v.product_count}개
                            </div>
                          )}
                        </div>
                      ) : v.product_count != null && v.product_count > 0 ? (
                        <span className="text-xs text-emerald-600">
                          {v.product_count}개 (목록 미수집)
                        </span>
                      ) : (
                        <span className="text-navy-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-navy-500">{v.biz_address ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-navy-600">{v.classification ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-navy-500">
                      <div>{v.source_site}</div>
                      {v.also_listed_on.length > 0 && (
                        <div className="text-emerald-600">
                          + {v.also_listed_on.length}개 몰
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/vendors/${v.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 pt-2">
            <PageLink
              page={page - 1}
              disabled={page <= 1}
              label="이전"
              sp={sp}
            />
            <span className="text-sm text-navy-500">
              {page} / {totalPages}
            </span>
            <PageLink
              page={page + 1}
              disabled={page >= totalPages}
              label="다음"
              sp={sp}
            />
          </nav>
        )}
      </section>
    </div>
  );
}

function PageLink({
  page,
  disabled,
  label,
  sp,
}: {
  page: number;
  disabled: boolean;
  label: string;
  sp: {
    q?: string;
    region?: string;
    classification?: string;
    source_site?: string;
    keyword?: string;
  };
}) {
  if (disabled) {
    return (
      <span className="rounded border border-navy-200 bg-navy-50 px-3 py-1 text-sm text-navy-400">
        {label}
      </span>
    );
  }
  const params = new URLSearchParams();
  if (sp.q) params.set('q', sp.q);
  if (sp.region) params.set('region', sp.region);
  if (sp.classification) params.set('classification', sp.classification);
  if (sp.source_site) params.set('source_site', sp.source_site);
  if (sp.keyword) params.set('keyword', sp.keyword);
  params.set('page', String(page));
  return (
    <Link
      href={`/vendors?${params.toString()}`}
      className="rounded border border-navy-300 bg-white px-3 py-1 text-sm font-medium text-navy-700 hover:bg-navy-50"
    >
      {label}
    </Link>
  );
}
