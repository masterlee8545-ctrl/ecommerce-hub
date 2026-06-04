#!/usr/bin/env node
/**
 * 등록된 모든 상품의 키워드를 셀로 스크래퍼 큐에 일괄 등록
 *
 * 사용법:
 *   1. npx tsx --env-file=.env.local scripts/enqueue-all-products.ts
 *   2. 별도 터미널: npm run sello:worker (백그라운드 처리)
 *
 * 워커가 큐에서 키워드 하나씩 꺼내서 쿠팡 1페이지 스크래핑 → DB 캐시
 * 키워드당 ~1분 소요 → 87개 약 1.5시간
 */
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { companies, products } from '../src/db/schema';
import { enqueueBatch } from '../src/lib/sello-scraper/job-queue';

(async () => {
  // 모든 회사의 research 단계 상품 키워드 수집
  const allCompanies = await db.select().from(companies);

  let totalEnqueued = 0;
  for (const co of allCompanies) {
    const rows = await db
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.company_id, co.id), eq(products.status, 'research')));

    if (rows.length === 0) continue;
    const keywords = rows.map((r) => r.name);

    console.log(`[${co.name}] ${keywords.length}개 키워드 큐잉...`);

    // admin 유저 ID 가져오기 (created_by 필요)
    const [adminUser] = await db.execute<{ id: string }>(sql`
      SELECT u.id FROM users u
      INNER JOIN user_companies uc ON uc.user_id = u.id
      WHERE uc.company_id = ${co.id} AND uc.role = 'owner'
      LIMIT 1
    `);
    if (!adminUser) {
      console.log(`  ⚠ owner 유저 없음 — 스킵`);
      continue;
    }

    try {
      const result = await enqueueBatch({
        companyId: co.id,
        keywords,
        forceFresh: false, // 캐시 24h 이내면 스킵
        filterCond: {},
        requestedBy: adminUser.id,
      });
      console.log(`  ✅ batch ${result.batchId.slice(0, 8)} — ${result.enqueued}개 큐잉됨`);
      totalEnqueued += result.enqueued;
    } catch (err) {
      console.error(`  ❌ 실패:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n총 ${totalEnqueued}개 큐잉 완료`);
  console.log('\n다음 단계:');
  console.log('  1. 다른 터미널에서 "npm run sello:worker" 실행');
  console.log('  2. Chrome 창이 자동으로 뜨면서 키워드 하나씩 처리');
  console.log('  3. 87개 × 약 1분 = 약 1.5시간 소요');
  console.log('  4. 끝나면 "npx tsx --env-file=.env.local scripts/evaluate-coupang-fit.ts" 로 평가');
  process.exit(0);
})().catch((e: unknown) => {
  console.error('실패:', e);
  process.exit(1);
});
