#!/usr/bin/env node
/**
 * vendors CSV 임포트 통로 검증 (1번 PR 검증 #2)
 *
 * 동작:
 *   1. 유어밸류 (agricultural) 회사 컨텍스트에서
 *   2. C:/개발/크롤링/cyso_all_sellers.csv preview → 통계 출력
 *   3. confirm → DB INSERT
 *   4. all_sellers.csv preview → dedup 결과 출력
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/probe-vendor-import.ts
 */
import { readFile } from 'node:fs/promises';

import { eq, sql } from 'drizzle-orm';

import { db, vendors, vendorProducts, withCompanyContext } from '../src/db';
import { companies } from '../src/db/schema';
import { confirmImport, previewImport } from '../src/lib/vendors/import';

const CYSO_CSV = 'C:/개발/크롤링/cyso_all_sellers.csv';
const ALL_CSV = 'C:/개발/크롤링/all_sellers.csv';

(async () => {
  // 유어밸류 (agricultural) 사용
  const rows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const company = rows[0];
  if (!company) {
    console.error('[probe] agricultural 회사 없음');
    process.exit(1);
  }
  console.log(`[probe] 회사: ${company.name} (${company.id.slice(0, 8)})`);

  // 클린 시작: 이전 테스트 데이터 삭제
  await withCompanyContext(company.id, async (tx) => {
    await tx.delete(vendorProducts).where(eq(vendorProducts.company_id, company.id));
    await tx.delete(vendors).where(eq(vendors.company_id, company.id));
    console.log('[probe] 기존 vendors 정리 완료');
  });

  // ── 1) cyso CSV preview + confirm ──
  console.log('\n[probe] === cyso_all_sellers.csv ===');
  const cysoText = await readFile(CYSO_CSV, 'utf-8');
  console.log(`[probe] 파일 크기: ${(cysoText.length / 1024).toFixed(1)} KB`);

  await withCompanyContext(company.id, async (tx) => {
    const preview = await previewImport({
      csvText: cysoText,
      companyId: company.id,
      createdBy: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx: tx as any,
    });

    if (preview.headerError) {
      console.error(`[probe] ❌ ${preview.headerError}`);
      throw new Error(preview.headerError);
    }

    console.log(`  인식된 헤더: ${preview.headerAnalysis.detected.length}개`);
    console.log(`  무시된 헤더: ${preview.headerAnalysis.ignored.length}개`);
    console.log(`  통계:`);
    console.log(`    전체:     ${preview.stats.total}`);
    console.log(`    신규:     ${preview.stats.new}`);
    console.log(`    업데이트: ${preview.stats.updated}`);
    console.log(`    스킵:     ${preview.stats.skipped}`);
    console.log(`    사업자번호 매칭: ${preview.stats.matchedByBizNo}`);
    console.log(`    이름+주소 매칭:   ${preview.stats.matchedByNameAddress}`);
    console.log(`    이름+대표 매칭:   ${preview.stats.matchedByNameRep}`);

    const t0 = Date.now();
    const applied = await confirmImport({
      result: preview,
      companyId: company.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx: tx as any,
    });
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`  → INSERT: ${applied.insertedVendors}건`);
    console.log(`  → UPDATE: ${applied.updatedVendors}건`);
    console.log(`  → 키워드: ${applied.insertedKeywords}건`);
    console.log(`  → 소요: ${elapsedSec}초`);
  });

  // ── 2) all_sellers CSV preview (dedup 확인) ──
  console.log('\n[probe] === all_sellers.csv (dedup 검증) ===');
  let allText: string;
  try {
    allText = await readFile(ALL_CSV, 'utf-8');
  } catch (e) {
    console.log(`[probe] all_sellers.csv 없음 — 스킵 (${e instanceof Error ? e.message : e})`);
    allText = '';
  }

  if (allText) {
    console.log(`[probe] 파일 크기: ${(allText.length / 1024).toFixed(1)} KB`);
    await withCompanyContext(company.id, async (tx) => {
      const preview = await previewImport({
        csvText: allText,
        companyId: company.id,
        createdBy: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });

      if (preview.headerError) {
        console.error(`[probe] ❌ ${preview.headerError}`);
        return;
      }

      console.log(`  통계:`);
      console.log(`    전체:     ${preview.stats.total}`);
      console.log(`    신규:     ${preview.stats.new}`);
      console.log(`    업데이트: ${preview.stats.updated}`);
      console.log(`    스킵:     ${preview.stats.skipped}`);
      console.log(`    사업자번호 매칭: ${preview.stats.matchedByBizNo}`);
      console.log(`    이름+주소 매칭:   ${preview.stats.matchedByNameAddress}`);
      console.log(`    이름+대표 매칭:   ${preview.stats.matchedByNameRep}`);

      const applied = await confirmImport({
        result: preview,
        companyId: company.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });
      console.log(`  → INSERT: ${applied.insertedVendors}건`);
      console.log(`  → UPDATE: ${applied.updatedVendors}건`);
      console.log(`  → 키워드: ${applied.insertedKeywords}건`);
    });
  }

  // ── 3) 최종 통계 ──
  console.log('\n[probe] === 최종 DB 상태 ===');
  await withCompanyContext(company.id, async (tx) => {
    const [totalVendors] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(vendors);
    const [withBizNo] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(vendors)
      .where(sql`biz_no IS NOT NULL`);
    const [withAlso] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(vendors)
      .where(sql`array_length(also_listed_on, 1) > 0`);
    const [totalKw] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(vendorProducts);

    console.log(`  vendors 총합:           ${totalVendors?.c ?? 0}`);
    console.log(`  사업자번호 있음:        ${withBizNo?.c ?? 0}`);
    console.log(`  also_listed_on 있음:    ${withAlso?.c ?? 0}`);
    console.log(`  vendor_products 키워드: ${totalKw?.c ?? 0}`);

    // 샘플 검색
    console.log('\n[probe] === 샘플 검색 ===');
    const samples = await tx
      .select({ name: vendors.biz_name, source: vendors.source_site, also: vendors.also_listed_on })
      .from(vendors)
      .where(sql`array_length(also_listed_on, 1) > 0`)
      .limit(5);
    console.log(`  다중 입점 농가 샘플 5건:`);
    for (const v of samples) {
      console.log(`    - ${v.name} (주: ${v.source}, 또: ${v.also.join(', ')})`);
    }

    // "남탑산방" / "토마토마" 검색
    for (const q of ['남탑산방', '토마토마', '신녕농협']) {
      const found = await tx
        .select({ name: vendors.biz_name, source: vendors.source_site, biz_no: vendors.biz_no })
        .from(vendors)
        .where(sql`biz_name ILIKE ${'%' + q + '%'}`)
        .limit(3);
      console.log(`  "${q}" 검색: ${found.length}건`);
      for (const v of found) {
        console.log(`    - ${v.name} | ${v.source} | ${v.biz_no ?? '-'}`);
      }
    }
  });

  console.log('\n[probe] ✅ 검증 완료');
  process.exit(0);
})().catch((err: unknown) => {
  console.error('[probe] 실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
