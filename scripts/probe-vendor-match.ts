#!/usr/bin/env node
/**
 * 농가 자동 매칭 알고리즘 검증 (2번 PR)
 *
 * 동작:
 *   - 유어밸류 (agricultural) 회사 컨텍스트에서
 *   - "참외", "한우", "딸기잼" 같은 다양한 상품명으로 매칭 결과 확인
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/probe-vendor-match.ts
 */
import { eq } from 'drizzle-orm';

import { withCompanyContext } from '../src/db';
import { companies } from '../src/db/schema';
import { extractAllKeywords } from '../src/lib/vendors/keywords';
import { matchVendorsForProduct } from '../src/lib/vendors/match';

(async () => {
  // 유어밸류 회사 사용
  const { db } = await import('../src/db');
  const rows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const company = rows[0];
  if (!company) {
    console.error('[probe] agricultural 회사 없음');
    process.exit(1);
  }
  console.log(`[probe] 회사: ${company.name} (${company.id.slice(0, 8)})`);

  const testCases = [
    { name: '참외 5kg 햇참외', peak: 7, prep: 5 },
    { name: '한우 등심 선물세트' },
    { name: '딸기잼 1kg' }, // 가공품 환원: 딸기
    { name: '샤인머스캣 2kg', peak: 9 }, // 포도로 매칭
    { name: '꾸지뽕 진액 30포', peak: 11 },
    { name: '캠핑의자 접이식' }, // 매칭 없어야 정상
    { name: '쌀 10kg 신동진' },
    { name: '쑥떡 모듬' }, // 가공품 환원: 약초
  ];

  for (const tc of testCases) {
    console.log(`\n[probe] === "${tc.name}" ===`);

    const { primary, reduced, combined } = extractAllKeywords(tc.name);
    console.log(`  추출 키워드: primary=[${primary.join(',')}] reduced=[${reduced.join(',')}] → combined=[${combined.join(',')}]`);

    if (combined.length === 0) {
      console.log('  ❌ 1차 농산물 키워드 미발견 (캠핑의자 같은 공산품)');
      continue;
    }

    const t0 = Date.now();
    const matches = await withCompanyContext(company.id, async (tx) =>
      matchVendorsForProduct(tx, {
        productName: tc.name,
        seasonPeakMonth: tc.peak ?? null,
        seasonPrepMonth: tc.prep ?? null,
        limit: 5,
      }),
    );
    const elapsed = Date.now() - t0;

    console.log(`  매칭 ${matches.length}건 (${elapsed}ms)`);
    matches.forEach((m, i) => {
      console.log(
        `  ${i + 1}. ${m.score}점 ${m.vendor.biz_name} (${m.vendor.source_site})`,
      );
      console.log(`     ☎ ${m.vendor.repr_tel_no || m.vendor.biz_mobile || '-'}`);
      console.log(`     이유: ${m.reasons.join(' / ')}`);
    });
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error('[probe] 실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
