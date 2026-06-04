/**
 * 마른오징어 + 반건조오징어 공급처 찾기
 *
 * 1. DB 농가 자동 매칭 (vendor_products + biz_sector)
 * 2. 외부 검색 (네이버 블로그 + 카카오 로컬)
 */
import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies } from '../src/db/schema';
import { discoverExternalVendors } from '../src/lib/research/external-vendor-discover';
import { matchVendorsForProduct } from '../src/lib/vendors/match';

(async () => {
  const [agriCo] = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'agricultural'));
  if (!agriCo) throw new Error('agricultural 회사 없음');

  const keywords = ['마른오징어', '반건조오징어'];

  for (const kw of keywords) {
    console.log(`\n\n===== ${kw} =====\n`);

    // 1. DB 농가 매칭
    console.log('## 🌾 DB 농가 매칭');
    const matches = await withCompanyContext(agriCo.id, async (tx) =>
      matchVendorsForProduct(tx, { productName: kw, limit: 10 }),
    );
    if (matches.length === 0) {
      console.log('  DB 농가 매칭 없음');
    } else {
      console.log(`  ${matches.length}곳 매칭`);
      matches.forEach((m, i) => {
        const phone = m.vendor.repr_tel_no ?? m.vendor.biz_mobile ?? '연락처 없음';
        const region = (m.vendor.biz_address ?? '').split(' ').slice(0, 2).join(' ');
        console.log(
          `  ${i + 1}. [${m.score}점] ${m.vendor.biz_name} | ☎ ${phone} | ${region} | ${m.vendor.source_site}`,
        );
      });
    }

    // 2. 외부 검색 (네이버 + 카카오)
    console.log('\n## 🔍 외부 검색 (네이버 블로그 + 카카오 로컬)');
    try {
      const ext = await discoverExternalVendors(kw);
      console.log(`  네이버 블로그 ${ext.naverHits.blog}건 / 지식인 ${ext.naverHits.kin}건`);
      console.log(`  추출 키워드: ${ext.brandCandidates.slice(0, 5).join(', ')}`);
      console.log(`\n  ${ext.candidates.length}개 후보 사업장:`);
      ext.candidates.slice(0, 10).forEach((c, i) => {
        const flag = c.confidence === 'high' ? '★★★' : c.confidence === 'medium' ? '★★' : '★';
        console.log(`  ${i + 1}. ${flag} ${c.bizName}`);
        if (c.phone) console.log(`     ☎ ${c.phone}`);
        if (c.address) console.log(`     📍 ${c.address}`);
        if (c.categoryName) console.log(`     🏷 ${c.categoryName}`);
        console.log(`     출처: ${c.sourceTitle.slice(0, 60)}`);
      });
    } catch (e) {
      console.log(`  외부 검색 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
