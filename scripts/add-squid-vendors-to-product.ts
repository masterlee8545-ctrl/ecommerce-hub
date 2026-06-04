/**
 * 건오징어 상품에 공급처 5곳 등록
 * 1. description 에 도매상 메모
 * 2. DB 에 있는 농가 → product_vendor_candidates 후보 등록
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products, productVendorCandidates, vendors } from '../src/db/schema';

const PRODUCT_NAME = '건오징어';
const VENDOR_NAMES_IN_DB = [
  '대일수산식품',
  '식도락푸드',
  '한길수산',
  '고부농산영농조합',
  '김제지평선조합공동사업법인',
];

const NEW_DESCRIPTION = `시즌 점수 4점, 1.6배. 자동 발굴.

📞 공급처 후보 (검색 결과)

[DB 매칭 — 위탁 농가/도매상]
- 대일수산식품 (전북 부안, 사이소-텃밭할매) — 사이소 직접 문의
- 식도락푸드 (전북 부안, 사이소-텃밭할매) — 사이소 직접 문의
- 한길수산 (전북 부안, 사이소-텃밭할매) — 사이소 직접 문의
- 고부농산영농조합 (정읍) — ☎ 063-535-0037 ✓사업자 확인
- 김제지평선조합공동사업법인 (김제) — ☎ 063-542-1505
- 베리라이스 (김제) — ☎ 063-546-7774
- 동김제농업협동조합 (김제) — ☎ 063-545-6233

[외부 검색 발견 — 건어물/수산물 전문점]
- 숙이네건어물 (충북 충주, 수산물판매) — ☎ 043-843-6764
- 건어물의달인 (대구 북구, 건어물 전문) — ☎ 053-248-1688
- 내돈내산 (충북 청주, 수산물판매) — ☎ 043-222-6700
- 반건조오징어 직판 (제주 서귀포 남원읍) — ☎ 010-2080-8790

→ 통화 우선순위: 숙이네건어물, 건어물의달인, 김제지평선조합
`;

(async () => {
  // 모든 회사에서 건오징어 찾기 (PROD-2026-0020 = 바이와이즈)
  const allCompanies = await db.select().from(companies);

  for (const co of allCompanies) {
    const productRows = await withCompanyContext(co.id, async (tx) =>
      tx
        .select()
        .from(products)
        .where(and(eq(products.company_id, co.id), eq(products.name, PRODUCT_NAME))),
    );

    if (productRows.length === 0) continue;

    for (const product of productRows) {
      console.log(`\n${co.name} ${product.code} ${product.name}`);

      // 1. description 업데이트
      await withCompanyContext(co.id, async (tx) => {
        await tx
          .update(products)
          .set({ description: NEW_DESCRIPTION, updated_at: new Date() })
          .where(eq(products.id, product.id));
      });
      console.log('  ✅ 공급처 메모 저장됨');

      // 2. DB 에 있는 농가 후보 등록
      await withCompanyContext(co.id, async (tx) => {
        const matched = await tx
          .select({ id: vendors.id, biz_name: vendors.biz_name })
          .from(vendors)
          .where(
            and(
              eq(vendors.company_id, co.id),
              inArray(vendors.biz_name, VENDOR_NAMES_IN_DB),
            ),
          );

        for (const v of matched) {
          // 중복 검사
          const exists = await tx
            .select({ id: productVendorCandidates.id })
            .from(productVendorCandidates)
            .where(
              and(
                eq(productVendorCandidates.product_id, product.id),
                eq(productVendorCandidates.vendor_id, v.id),
              ),
            );

          if (exists.length === 0) {
            await tx.insert(productVendorCandidates).values({
              company_id: co.id,
              product_id: product.id,
              vendor_id: v.id,
              status: '후보',
              match_reason: '건오징어/마른오징어/반건조오징어 통합 검색 결과',
              notes: '형 직접 추천 — 통화 대기',
            });
            console.log(`  ⭐ 후보 등록: ${v.biz_name}`);
          } else {
            console.log(`  ⏭ 이미 후보: ${v.biz_name}`);
          }
        }
      });
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
