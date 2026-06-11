/**
 * 시스템 종합 점검
 *   1) 마이그레이션 적용 여부 (핵심 테이블/컬럼 존재)
 *   2) 데이터 카운트 (companies / products / vendors / 시장데이터)
 *   3) 셀록홈즈 쿠키 상태
 *   4) RLS 정책 존재 여부
 */
import { sql } from 'drizzle-orm';

import { db } from '../src/db';

interface CheckRow {
  ok: boolean;
  label: string;
  detail: string;
}

const results: CheckRow[] = [];

function add(ok: boolean, label: string, detail: string) {
  results.push({ ok, label, detail });
}

(async () => {
  // ── 1. 테이블 존재 여부 ──
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const tableNames = new Set(tables.map((r) => String(r['table_name'])));
  const REQUIRED_TABLES = [
    'companies', 'users', 'products', 'vendors',
    'vendor_products', 'vendor_call_logs', 'product_vendor_candidates',
    'vendor_access_grants', 'system_settings',
    'keyword_chart_daily', 'keyword_chart_fetches', 'scrape_jobs',
  ];
  for (const t of REQUIRED_TABLES) {
    add(tableNames.has(t), `테이블 ${t}`, tableNames.has(t) ? '존재' : '❗ 없음 — 마이그레이션 미적용');
  }

  // ── 2. 핵심 컬럼 존재 여부 (최근 마이그레이션) ──
  const colChecks: Array<[string, string, string]> = [
    ['vendors', 'work_status', '0021'],
    ['vendors', 'status_note', '0021'],
    ['products', 'coupang_low_review_count', '0020'],
    ['products', 'monthly_search_volume', '0019'],
    ['products', 'coupang_top_listings', '0017'],
    ['products', 'supply_type', '0015'],
    ['vendor_call_logs', 'supplier_price', '0018'],
  ];
  for (const [table, col, mig] of colChecks) {
    const r = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${col}
    `);
    add(r.length > 0, `컬럼 ${table}.${col}`, r.length > 0 ? `존재 (${mig})` : `❗ 없음 — ${mig} 미적용`);
  }

  // ── 3. 데이터 카운트 ──
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM companies) AS companies,
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM products) AS products,
      (SELECT count(*) FROM products WHERE status = 'research') AS research_products,
      (SELECT count(*) FROM vendors) AS vendors,
      (SELECT count(*) FROM products WHERE market_prices_updated_at IS NOT NULL) AS market_filled,
      (SELECT count(*) FROM products WHERE coupang_low_review_count IS NOT NULL) AS review_filled,
      (SELECT count(*) FROM scrape_jobs WHERE status = 'pending') AS jobs_pending,
      (SELECT count(*) FROM scrape_jobs WHERE status = 'failed') AS jobs_failed
  `);
  const c = counts[0] as Record<string, unknown>;
  add(Number(c['companies']) >= 3, '법인 수', `${c['companies']} (기대 3+)`);
  add(Number(c['products']) > 0, '전체 상품', `${c['products']}`);
  add(true, 'research 상품', `${c['research_products']}`);
  add(Number(c['vendors']) >= 1800, '농가/공급처', `${c['vendors']} (기대 1,835)`);
  add(true, '시장가 채워진 상품', `${c['market_filled']}`);
  add(true, '리뷰분포 채워진 상품', `${c['review_filled']}`);
  add(true, 'scrape_jobs 대기/실패', `pending ${c['jobs_pending']} / failed ${c['jobs_failed']}`);

  // ── 4. 셀록홈즈 쿠키 ──
  const cookie = await db.execute(sql`
    SELECT length(value) AS len, updated_at FROM system_settings WHERE key = 'sellochomes_cookie'
  `);
  if (cookie.length > 0) {
    const row = cookie[0] as Record<string, unknown>;
    add(true, '셀록홈즈 쿠키', `len=${row['len']}, 갱신 ${row['updated_at']}`);
  } else {
    add(false, '셀록홈즈 쿠키', '❗ DB 에 없음');
  }

  // ── 5. RLS 활성 여부 ──
  const rls = await db.execute(sql`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('products', 'vendors', 'vendor_call_logs') AND relkind = 'r'
  `);
  for (const r of rls) {
    const row = r as Record<string, unknown>;
    const on = row['relrowsecurity'] === true;
    add(on, `RLS ${row['relname']}`, on ? '활성' : '❗ 비활성');
  }

  // ── 출력 ──
  console.log('\n══════════ DB 점검 결과 ══════════\n');
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.label.padEnd(34)} ${r.detail}`);
    if (r.ok) okCount++;
    else failCount++;
  }
  console.log(`\n통과 ${okCount} / 실패 ${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error('점검 자체 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
