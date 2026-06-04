#!/usr/bin/env node
/**
 * 등록 상품 정리 + 농수산물 도매처(농가) 자동 매칭
 *
 * 농수산물: 각 상품별로 매칭 농가 top 5 (이름/전화/지역/출처)
 * 공산품: 키워드 + 카테고리 + 추천 사유 (1688 직접 확인)
 */
import { and, eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { matchVendorsForProduct, type MatchResult } from '../src/lib/vendors/match';

interface AgriProduct {
  code: string;
  name: string;
  category: string | null;
  seasonScore: number | null;
  seasonRatio: number | null;
  peakMonth: number | null;
  vendors: Array<{
    score: number;
    name: string;
    phone: string | null;
    address: string | null;
    sourceSite: string;
    reasons: string[];
  }>;
}

interface IndProduct {
  code: string;
  name: string;
  category: string | null;
  seasonScore: number | null;
  seasonRatio: number | null;
  description: string | null;
}

(async () => {
  const agriRows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const agriCo = agriRows[0]!;
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  // ─── 농수산물 + 도매처 매칭 ───
  const agriList = await withCompanyContext(agriCo.id, async (tx) => {
    return tx
      .select({
        code: products.code,
        name: products.name,
        category: products.category,
        seasonScore: products.season_score,
        seasonRatio: products.seasonality_ratio,
        peakMonth: products.season_peak_month,
        prepMonth: products.season_prep_month,
      })
      .from(products)
      .where(and(eq(products.company_id, agriCo.id), eq(products.status, 'research')));
  });

  const agriResult: AgriProduct[] = [];
  for (const p of agriList) {
    const matches = await withCompanyContext(agriCo.id, async (tx) =>
      matchVendorsForProduct(tx, {
        productName: p.name,
        seasonPeakMonth: p.peakMonth ?? null,
        seasonPrepMonth: p.prepMonth ?? null,
        limit: 5,
      }),
    );
    agriResult.push({
      code: p.code,
      name: p.name,
      category: p.category,
      seasonScore: p.seasonScore,
      seasonRatio: p.seasonRatio ? Number(p.seasonRatio) : null,
      peakMonth: p.peakMonth,
      vendors: matches.map((m: MatchResult) => ({
        score: m.score,
        name: m.vendor.biz_name,
        phone: m.vendor.repr_tel_no ?? m.vendor.biz_mobile,
        address: m.vendor.biz_address,
        sourceSite: m.vendor.source_site,
        reasons: m.reasons,
      })),
    });
  }

  // 정렬: 매칭 농가 많고 시즌성 강한 순
  agriResult.sort((a, b) => {
    const aScore = a.vendors.length * 10 + (a.seasonRatio ?? 0);
    const bScore = b.vendors.length * 10 + (b.seasonRatio ?? 0);
    return bScore - aScore;
  });

  // ─── 공산품 정리 ───
  const indList = await withCompanyContext(indCo.id, async (tx) => {
    return tx
      .select({
        code: products.code,
        name: products.name,
        category: products.category,
        seasonScore: products.season_score,
        seasonRatio: products.seasonality_ratio,
        description: products.description,
      })
      .from(products)
      .where(and(eq(products.company_id, indCo.id), eq(products.status, 'research')));
  });

  const indResult: IndProduct[] = indList.map((p) => ({
    code: p.code,
    name: p.name,
    category: p.category,
    seasonScore: p.seasonScore,
    seasonRatio: p.seasonRatio ? Number(p.seasonRatio) : null,
    description: p.description,
  }));
  indResult.sort((a, b) => (b.seasonRatio ?? 0) - (a.seasonRatio ?? 0));

  // ─── 마크다운 출력 ───
  console.log('# 🌾 농수산물 + 도매처 매칭\n');
  console.log(`**총 ${agriResult.length}개** (유어밸류 (주))\n`);

  // 매칭 농가 있는 상품 먼저
  const withVendors = agriResult.filter((p) => p.vendors.length > 0);
  const withoutVendors = agriResult.filter((p) => p.vendors.length === 0);

  console.log(`## 🟢 도매처(농가) 매칭됨 — ${withVendors.length}개\n`);

  withVendors.forEach((p, i) => {
    const season = p.seasonScore
      ? `${p.seasonScore}점${p.seasonRatio ? `, ${p.seasonRatio.toFixed(1)}배` : ''}${p.peakMonth ? `, 피크 ${p.peakMonth}월` : ''}`
      : '상시';
    console.log(`### ${i + 1}. ${p.name} \`${p.code}\` (${p.category}) — ${season}`);
    console.log('');
    console.log('| 점수 | 농가 | ☎ 연락처 | 지역 | 출처 |');
    console.log('|---|---|---|---|---|');
    p.vendors.forEach((v) => {
      const region = (v.address ?? '').split(' ').slice(0, 2).join(' ');
      console.log(`| ${v.score}점 | **${v.name}** | \`${v.phone || '-'}\` | ${region || '-'} | ${v.sourceSite} |`);
    });
    console.log('');
  });

  console.log(`\n## ⚠️ 도매처 매칭 안 됨 — ${withoutVendors.length}개`);
  console.log(`> DB 농가 풀 (전북+경북+충북+제주 일부 + 김제) 에 해당 품목 농가 없음. 사이소 추가 크롤링 또는 외부 검색 필요.\n`);
  withoutVendors.forEach((p) => {
    const season = p.seasonScore
      ? `${p.seasonScore}점${p.seasonRatio ? `, ${p.seasonRatio.toFixed(1)}배` : ''}`
      : '상시';
    console.log(`- ${p.code} **${p.name}** (${p.category}, ${season})`);
  });

  console.log('\n---\n');

  // 공산품
  console.log(`# 🏭 공산품 추천 — 총 ${indResult.length}개 (바이와이즈 (주))\n`);
  console.log(`> 1688 직접 소싱 — 도매처는 형이 직접 1688/타오바오에서 확인\n`);
  console.log('| # | 코드 | 키워드 | 카테고리 | 시즌 | 추천 사유 |');
  console.log('|---|---|---|---|---|---|');

  indResult.forEach((p, i) => {
    const season = p.seasonScore
      ? `${p.seasonScore}점, ${p.seasonRatio ? p.seasonRatio.toFixed(1) + '배' : '-'}`
      : '상시';
    const desc = (p.description ?? '').slice(0, 60);
    console.log(`| ${i + 1} | \`${p.code}\` | **${p.name}** | ${p.category} | ${season} | ${desc} |`);
  });

  // 통계
  console.log('\n---\n');
  console.log(`## 통계`);
  console.log(`- 농수산물: ${agriResult.length}개 (매칭됨 ${withVendors.length}, 안됨 ${withoutVendors.length})`);
  console.log(`- 공산품: ${indResult.length}개`);
  console.log(`- 합계: ${agriResult.length + indResult.length}개`);

  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
