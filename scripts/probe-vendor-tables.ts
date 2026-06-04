#!/usr/bin/env node
/**
 * vendor 관련 테이블/컬럼 존재 검증 (1번 PR 검증용)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/probe-vendor-tables.ts
 */
import { sql } from 'drizzle-orm';

import { db } from '../src/db';

interface TableInfo extends Record<string, unknown> {
  table_name: string;
  column_count: number;
}

interface PolicyInfo extends Record<string, unknown> {
  tablename: string;
  policyname: string;
  cmd: string;
}

(async () => {
  // 1) 5 개 신규 테이블 존재 확인
  const expectedTables = [
    'vendors',
    'vendor_products',
    'vendor_call_logs',
    'product_vendor_candidates',
    'vendor_access_grants',
  ];

  const tables = await db.execute<TableInfo>(sql`
    SELECT t.table_name, COUNT(c.column_name)::int AS column_count
    FROM information_schema.tables t
    LEFT JOIN information_schema.columns c
      ON c.table_name = t.table_name AND c.table_schema = t.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_name IN ('vendors','vendor_products','vendor_call_logs','product_vendor_candidates','vendor_access_grants')
    GROUP BY t.table_name
    ORDER BY t.table_name
  `);

  console.log('[probe] === 신규 테이블 ===');
  for (const t of tables) {
    console.log(`  ${t.table_name.padEnd(30)} ${t.column_count} cols`);
  }

  const found = new Set(tables.map((t) => t.table_name));
  const missing = expectedTables.filter((t) => !found.has(t));
  if (missing.length) {
    console.error(`[probe] ❌ 누락 테이블: ${missing.join(', ')}`);
    process.exit(1);
  }

  // 2) products 신규 컬럼 6 개 확인
  const expectedCols = [
    'supply_type',
    'primary_vendor_id',
    'season_peak_month',
    'season_prep_month',
    'seasonality_ratio',
    'season_score',
  ];

  const cols = await db.execute<{ column_name: string } & Record<string, unknown>>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name IN ('supply_type','primary_vendor_id','season_peak_month','season_prep_month','seasonality_ratio','season_score')
    ORDER BY column_name
  `);

  console.log('\n[probe] === products 신규 컬럼 ===');
  for (const c of cols) {
    console.log(`  ${c.column_name}`);
  }

  const foundCols = new Set(cols.map((c) => c.column_name));
  const missingCols = expectedCols.filter((c) => !foundCols.has(c));
  if (missingCols.length) {
    console.error(`[probe] ❌ 누락 컬럼: ${missingCols.join(', ')}`);
    process.exit(1);
  }

  // 3) RLS 정책 확인
  const policies = await db.execute<PolicyInfo>(sql`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('vendors','vendor_products','vendor_call_logs','product_vendor_candidates','vendor_access_grants')
    ORDER BY tablename, policyname
  `);

  console.log('\n[probe] === RLS 정책 ===');
  for (const p of policies) {
    console.log(`  ${p.tablename.padEnd(30)} ${p.policyname.padEnd(30)} ${p.cmd}`);
  }

  // 4) RLS 활성화 확인
  const rlsStatus = await db.execute<{ tablename: string; rowsecurity: boolean } & Record<string, unknown>>(sql`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('vendors','vendor_products','vendor_call_logs','product_vendor_candidates','vendor_access_grants')
    ORDER BY tablename
  `);

  console.log('\n[probe] === RLS 활성화 ===');
  for (const r of rlsStatus) {
    console.log(`  ${r.tablename.padEnd(30)} ${r.rowsecurity ? '✅ enabled' : '❌ disabled'}`);
  }

  const rlsDisabled = rlsStatus.filter((r) => !r.rowsecurity);
  if (rlsDisabled.length) {
    console.error(`\n[probe] ❌ RLS 미활성: ${rlsDisabled.map((r) => r.tablename).join(', ')}`);
    process.exit(1);
  }

  console.log('\n[probe] ✅ 모든 검증 통과');
  process.exit(0);
})().catch((err: unknown) => {
  console.error('[probe] 실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
