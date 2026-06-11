#!/usr/bin/env node
/**
 * 등록 상품 키워드의 일별 차트 수집 → 성장률(search_growth_pct) 채우기
 *
 * 흐름:
 *   1) 모든 상품명 수집 (research 100개)
 *   2) keyword_chart_daily 에 없거나 7일 이상 묵은 키워드만 chart API 호출
 *   3) anchor 보정 YoY 성장률 계산 → products.search_growth_pct UPDATE
 *
 * 사용: npx tsx --env-file=.env.local scripts/fetch-product-charts.ts
 */
import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { keywordChartDaily, keywordChartFetches, products } from '../src/db/schema';
import {
  SellochomesError,
  fetchKeywordChart,
  type SCChartDataPoint,
} from '../src/lib/sellochomes/client';

const RATE_LIMIT_MS = 400;
const STALE_DAYS = 7;
const RECENT_DAYS = 91;
const PCT = 100;

async function saveDaily(keyword: string, data: SCChartDataPoint[]): Promise<void> {
  if (data.length === 0) return;
  await db.delete(keywordChartDaily).where(eq(keywordChartDaily.keyword, keyword));
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK).map((d) => ({
      keyword,
      period: d.period,
      ratio: d.ratio,
    }));
    await db.insert(keywordChartDaily).values(chunk);
  }
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
  await db
    .insert(keywordChartFetches)
    .values({
      keyword,
      fetched_at: new Date(),
      data_start_date: sorted[0]?.period ?? null,
      data_end_date: sorted[sorted.length - 1]?.period ?? null,
      point_count: data.length,
      last_status: 'ok',
      last_error: null,
    })
    .onConflictDoUpdate({
      target: keywordChartFetches.keyword,
      set: {
        fetched_at: new Date(),
        data_start_date: sorted[0]?.period ?? null,
        data_end_date: sorted[sorted.length - 1]?.period ?? null,
        point_count: data.length,
        last_status: 'ok',
        last_error: null,
      },
    });
}

async function computeGrowth(keyword: string): Promise<number | null> {
  const recent = await db.execute(sql`
    WITH anchor AS (
      SELECT max(period::date) AS d FROM keyword_chart_daily WHERE keyword = ${keyword}
    )
    SELECT avg(ratio)::float AS avg FROM keyword_chart_daily, anchor
    WHERE keyword = ${keyword}
      AND period::date > (anchor.d - ${RECENT_DAYS}::int)
      AND period::date <= anchor.d
  `);
  const lastYear = await db.execute(sql`
    WITH anchor AS (
      SELECT max(period::date) AS d FROM keyword_chart_daily WHERE keyword = ${keyword}
    )
    SELECT avg(ratio)::float AS avg FROM keyword_chart_daily, anchor
    WHERE keyword = ${keyword}
      AND period::date > (anchor.d - interval '1 year' - ${RECENT_DAYS}::int * interval '1 day')
      AND period::date <= (anchor.d - interval '1 year')
  `);
  const r = (recent[0] as { avg: number | null } | undefined)?.avg;
  const ly = (lastYear[0] as { avg: number | null } | undefined)?.avg;
  if (r == null || ly == null || ly === 0) return null;
  return ((r - ly) / ly) * PCT;
}

(async () => {
  const rows = await db
    .select({ id: products.id, company_id: products.company_id, name: products.name })
    .from(products);
  console.log(`상품 ${rows.length}개\n`);

  let fetched = 0;
  let cached = 0;
  let noData = 0;
  let growthFilled = 0;

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i]!;
    // 신선한 차트 있으면 fetch 생략
    const fresh = await db.execute(sql`
      SELECT 1 FROM keyword_chart_fetches
      WHERE keyword = ${p.name}
        AND last_status = 'ok'
        AND fetched_at > now() - ${STALE_DAYS}::int * interval '1 day'
    `);
    if (fresh.length === 0) {
      try {
        const data = await fetchKeywordChart(p.name);
        if (data.length === 0) {
          noData++;
          console.log(`  📭 [${i + 1}/${rows.length}] ${p.name}: 차트 없음`);
        } else {
          await saveDaily(p.name, data);
          fetched++;
          console.log(`  ⬇ [${i + 1}/${rows.length}] ${p.name}: ${data.length}일치 수집`);
        }
      } catch (e) {
        if (e instanceof SellochomesError && e.code === 'auth_expired') {
          console.error('🚨 세션 만료 — 중단');
          break;
        }
        console.warn(`  ❌ ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    } else {
      cached++;
    }

    // 성장률 계산 + 저장
    const growth = await computeGrowth(p.name);
    if (growth !== null) {
      await withCompanyContext(p.company_id, async (tx) => {
        await tx
          .update(products)
          .set({ search_growth_pct: growth.toFixed(1) })
          .where(eq(products.id, p.id));
      });
      growthFilled++;
    }
  }

  console.log(`\n=== 결과 ===`);
  console.log(`  차트 신규 수집: ${fetched}, 캐시 사용: ${cached}, 차트 없음: ${noData}`);
  console.log(`  성장률 채움: ${growthFilled}/${rows.length}`);
  process.exit(0);
})().catch((e) => {
  console.error('치명적:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
