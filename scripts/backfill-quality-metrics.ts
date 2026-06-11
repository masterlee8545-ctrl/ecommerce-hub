/**
 * 0022 선정 보완 지표 backfill
 *   - coupang_top1_share / top3_share: 기존 coupang_top_listings jsonb 에서 계산
 *   - search_growth_pct: keyword_chart_daily 에 데이터 있는 키워드만
 *   - coupang_ad_count: 기존 데이터엔 광고 제외 후 저장이라 계산 불가 → 다음 fill 때 채움
 */
import { eq, isNotNull, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { products } from '../src/db/schema';

interface Listing {
  rank: number;
  reviewCount: number;
}

const PCT = 100;
const RECENT_DAYS = 91;

(async () => {
  // ── 1. 독점도 backfill ──
  const rows = await db
    .select({
      id: products.id,
      company_id: products.company_id,
      name: products.name,
      listings: products.coupang_top_listings,
    })
    .from(products)
    .where(isNotNull(products.coupang_top_listings));

  let shareFilled = 0;
  for (const r of rows) {
    const listings = (r.listings as Listing[] | null) ?? [];
    const reviews = listings
      .map((l) => l.reviewCount)
      .filter((n) => typeof n === 'number' && n >= 0);
    if (reviews.length === 0) continue;
    const total = reviews.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const sorted = [...reviews].sort((a, b) => b - a);
    const top1 = ((sorted[0] ?? 0) / total) * PCT;
    const top3 = (sorted.slice(0, 3).reduce((a, b) => a + b, 0) / total) * PCT;

    await withCompanyContext(r.company_id, async (tx) => {
      await tx
        .update(products)
        .set({
          coupang_top1_share: top1.toFixed(1),
          coupang_top3_share: top3.toFixed(1),
        })
        .where(eq(products.id, r.id));
    });
    shareFilled++;
  }
  console.log(`독점도 채움: ${shareFilled}/${rows.length}`);

  // ── 2. 성장률 backfill (chart 데이터 있는 키워드만) ──
  const allProducts = await db
    .select({ id: products.id, company_id: products.company_id, name: products.name })
    .from(products);

  let growthFilled = 0;
  let noChart = 0;
  for (const p of allProducts) {
    // anchor = 이 키워드의 최신 데이터 날짜 — fetch 가 오래됐어도 양쪽 창을 같은 기준으로 비교
    const recent = await db.execute(sql`
      WITH anchor AS (
        SELECT max(period::date) AS d FROM keyword_chart_daily WHERE keyword = ${p.name}
      )
      SELECT avg(ratio)::float AS avg FROM keyword_chart_daily, anchor
      WHERE keyword = ${p.name}
        AND period::date > (anchor.d - ${RECENT_DAYS}::int)
        AND period::date <= anchor.d
    `);
    const lastYear = await db.execute(sql`
      WITH anchor AS (
        SELECT max(period::date) AS d FROM keyword_chart_daily WHERE keyword = ${p.name}
      )
      SELECT avg(ratio)::float AS avg FROM keyword_chart_daily, anchor
      WHERE keyword = ${p.name}
        AND period::date > (anchor.d - interval '1 year' - ${RECENT_DAYS}::int * interval '1 day')
        AND period::date <= (anchor.d - interval '1 year')
    `);
    const r = (recent[0] as { avg: number | null } | undefined)?.avg;
    const ly = (lastYear[0] as { avg: number | null } | undefined)?.avg;
    if (r == null || ly == null || ly === 0) {
      noChart++;
      continue;
    }
    const growth = ((r - ly) / ly) * PCT;
    await withCompanyContext(p.company_id, async (tx) => {
      await tx
        .update(products)
        .set({ search_growth_pct: growth.toFixed(1) })
        .where(eq(products.id, p.id));
    });
    growthFilled++;
    console.log(`  📈 ${p.name}: ${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`);
  }
  console.log(`성장률 채움: ${growthFilled}, 차트 데이터 없음: ${noChart}`);
  process.exit(0);
})().catch((e) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
