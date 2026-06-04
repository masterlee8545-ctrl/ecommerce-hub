#!/usr/bin/env node
/**
 * 공산품 후보 교체 (이재홍 대표 기준 반영)
 *
 * 기준:
 *   - 저관여 제품 (브랜드 인지도 영향 작음)
 *   - 화장품 / 영양제 / 의류 브랜드 / 가전 제외
 *   - 검색량 증가 + 쿠팡 진입 기회 있는 카테고리
 *
 * 동작:
 *   1. 로션 + 러닝용품 삭제 (브랜드 영향 큰 카테고리)
 *   2. 데코타일 + 습윤밴드 신규 등록
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

(async () => {
  const indRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'industrial'));
  const indCompany = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0];
  if (!indCompany) throw new Error('industrial 회사 없음');
  console.log(`회사: ${indCompany.name}\n`);

  // 1) 탈락 — 로션 / 러닝용품 삭제
  console.log('=== 탈락 처리 ===');
  const removed = await withCompanyContext(indCompany.id, async (tx) => {
    return tx
      .delete(products)
      .where(
        and(
          eq(products.company_id, indCompany.id),
          inArray(products.name, ['로션', '러닝용품']),
        ),
      )
      .returning({ code: products.code, name: products.name });
  });
  for (const r of removed) console.log(`  ❌ 삭제: ${r.code} ${r.name}`);

  // 2) 신규 — 데코타일 + 습윤밴드
  console.log('\n=== 신규 등록 ===');
  const NEW_SEEDS = [
    {
      name: '데코타일',
      category: '인테리어',
      season_peak_month: 7,
      season_prep_month: 5,
      seasonality_ratio: 1.2,
      season_score: 5,
      description:
        '인테리어 DIY 자재. 1688 도매 풍부, 무브랜드 진입 가능. 작은 평수 셀프 인테리어 트렌드 + 쿠팡 1페이지 리뷰 빈약 = 진입 기회.',
    },
    {
      name: '습윤밴드',
      category: '의료/생활',
      season_peak_month: 6,
      season_prep_month: 5,
      seasonality_ratio: 1.6,
      season_score: 5,
      description:
        '의료 생활용품. 브랜드 영향 작음, 1688/타오바오 도매 풍부. 검색량 안정 + 쿠팡 진입 장벽 낮음.',
    },
  ];

  for (const s of NEW_SEEDS) {
    const code = await suggestNextProductCode(indCompany.id);
    const inserted = await withCompanyContext(indCompany.id, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          company_id: indCompany.id,
          code,
          name: s.name,
          category: s.category,
          status: 'research',
          description: s.description,
          supply_type: 'overseas_supplier',
          season_peak_month: s.season_peak_month,
          season_prep_month: s.season_prep_month,
          seasonality_ratio: s.seasonality_ratio.toString(),
          season_score: s.season_score,
        })
        .returning({ id: products.id, code: products.code, name: products.name });
      return row!;
    });
    console.log(`  ✅ ${inserted.code} — ${inserted.name}`);
    console.log(`     http://localhost:3002/products/${inserted.id}`);
  }

  // 3) 현재 공산품 목록
  console.log('\n=== 바이와이즈 (주) 현재 공산품 목록 ===');
  const current = await withCompanyContext(indCompany.id, async (tx) => {
    return tx
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        category: products.category,
      })
      .from(products)
      .where(
        and(
          eq(products.company_id, indCompany.id),
          eq(products.status, 'research'),
        ),
      );
  });
  for (const p of current) {
    console.log(`  ${p.code} ${p.name} (${p.category})`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
