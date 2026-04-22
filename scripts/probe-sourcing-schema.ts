#!/usr/bin/env node
/**
 * 0004 마이그레이션이 제대로 적용됐는지 확인.
 */
import { sql } from 'drizzle-orm';

import { db } from '../src/db';

(async () => {
  // products 전체 컬럼 덤프
  const allProductCols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
    ORDER BY column_name
  `);
  console.log('[DEBUG] 전체 products 컬럼 개수:', (allProductCols as unknown as unknown[]).length);
  const allRows = allProductCols as unknown as Array<{ column_name: string }>;
  for (const r of allRows) {
    console.log(`  - ${r.column_name}`);
  }
  console.log('');

  // 새 테이블
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('product_plans', 'marketing_activities')
    ORDER BY table_name
  `);
  console.log('\n[새 테이블]');
  for (const row of tables as unknown as Array<{ table_name: string }>) {
    console.log(`  ✓ ${row.table_name}`);
  }

  // RLS 활성화 여부
  const rls = await db.execute(sql`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('product_plans', 'marketing_activities')
    ORDER BY c.relname
  `);
  console.log('\n[RLS 상태]');
  for (const row of rls as unknown as Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean }>) {
    console.log(`  ${row.table_name}: enabled=${row.rls_enabled} forced=${row.rls_forced}`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
