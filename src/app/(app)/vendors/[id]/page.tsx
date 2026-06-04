/**
 * /vendors/[id] — 농가 상세 (간단)
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-3 (신뢰도 마킹), §1 P-9
 *
 * 역할:
 *   - 농가 기본 정보 표시 (사업자명/번호/대표/연락처/주소/품목)
 *   - 통화 모달은 3번 PR 에서 추가 (지금은 자리만 잡아두기)
 *   - 같은 사업자의 also_listed_on 표시
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, ExternalLink, MapPin, Phone, User } from 'lucide-react';

import { withCompanyContext } from '@/db';
import { requireCompanyContext } from '@/lib/auth/session';
import { getVendor } from '@/lib/vendors/search';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VendorDetailPage({ params }: PageProps) {
  const ctx = await requireCompanyContext();
  const { id } = await params;

  // UUID 형식 검증
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }

  const vendor = await withCompanyContext(ctx.companyId, async (tx) => getVendor(tx, id));

  if (!vendor) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        농가 목록
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-navy-900">{vendor.biz_name}</h1>
          {vendor.biz_no_confidence === 'confirmed' && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              ✓ 사업자 확인
            </span>
          )}
        </div>
        {vendor.biz_sector && (
          <p className="text-sm text-navy-500">{vendor.biz_sector}</p>
        )}
      </header>

      {/* 기본 정보 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InfoCard icon={<User className="h-4 w-4" />} title="대표 / 사업자번호">
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-navy-500">대표자: </span>
              <span className="font-medium text-navy-900">{vendor.biz_owner_name ?? '-'}</span>
            </div>
            <div>
              <span className="text-navy-500">사업자번호: </span>
              <span className="font-medium text-navy-900">
                {vendor.biz_no ?? '-'}
                <span className="ml-1 text-xs text-navy-400">
                  ({vendor.biz_no_confidence})
                </span>
              </span>
            </div>
            {vendor.biz_type && (
              <div>
                <span className="text-navy-500">업태: </span>
                <span className="text-navy-700">{vendor.biz_type}</span>
              </div>
            )}
          </div>
        </InfoCard>

        <InfoCard icon={<Phone className="h-4 w-4" />} title="연락처">
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-navy-500">대표 번호: </span>
              {vendor.repr_tel_no ? (
                <a
                  href={`tel:${vendor.repr_tel_no.replace(/[^\d+]/g, '')}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {vendor.repr_tel_no}
                </a>
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </div>
            <div>
              <span className="text-navy-500">휴대전화: </span>
              {vendor.biz_mobile ? (
                <a
                  href={`tel:${vendor.biz_mobile.replace(/[^\d+]/g, '')}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {vendor.biz_mobile}
                </a>
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </div>
            <p className="pt-1 text-xs text-navy-400">
              ※ 통화 결과 기록 모달은 3번 PR 에서 활성화됩니다.
            </p>
          </div>
        </InfoCard>

        <InfoCard icon={<MapPin className="h-4 w-4" />} title="주소">
          <div className="text-sm text-navy-700">
            {vendor.biz_address ?? '-'}
            {vendor.biz_zip && (
              <span className="ml-2 text-xs text-navy-400">({vendor.biz_zip})</span>
            )}
          </div>
        </InfoCard>

        <InfoCard icon={<ExternalLink className="h-4 w-4" />} title="출처">
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-navy-500">주 출처: </span>
              <span className="font-medium text-navy-900">{vendor.source_site}</span>
            </div>
            {vendor.also_listed_on.length > 0 && (
              <div>
                <span className="text-navy-500">또 입점한 곳: </span>
                <span className="text-emerald-700">{vendor.also_listed_on.join(', ')}</span>
              </div>
            )}
            {vendor.source_url && (
              <div>
                <a
                  href={vendor.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  원본 페이지 열기
                </a>
              </div>
            )}
          </div>
        </InfoCard>
      </section>

      {/* 분류 + 품목 */}
      {(vendor.classification || vendor.product_keywords_all) && (
        <section className="rounded-lg border border-navy-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">분류 / 취급 품목</h2>
          {vendor.classification && (
            <p className="text-sm">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {vendor.classification}
              </span>
              {vendor.classification_basis && (
                <span className="ml-2 text-xs text-navy-500">
                  ({vendor.classification_basis})
                </span>
              )}
            </p>
          )}
          {vendor.product_keywords_all && (
            <p className="mt-2 text-sm text-navy-600">{vendor.product_keywords_all}</p>
          )}
        </section>
      )}

      {/* 소개 (HTML) */}
      {vendor.intro_html && (
        <section className="rounded-lg border border-navy-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">업체 소개</h2>
          <div
            className="prose prose-sm max-w-none text-navy-700"
            // 출처가 신뢰 가능한 자료 — 1번 PR 범위에서는 그대로 렌더
            // (4번 PR 에서 공유 풀로 확장될 때 DOMPurify 도입 예정)
            dangerouslySetInnerHTML={{ __html: vendor.intro_html }}
          />
        </section>
      )}

      {/* 메타 */}
      <footer className="border-t border-navy-200 pt-4 text-xs text-navy-400">
        등록: {new Date(vendor.created_at).toLocaleString('ko-KR')}
        {' · '}
        최종 수정: {new Date(vendor.updated_at).toLocaleString('ko-KR')}
      </footer>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-navy-800">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}
