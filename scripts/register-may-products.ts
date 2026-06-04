#!/usr/bin/env node
/**
 * 5월 추천 상품 일괄 등록 (이재홍 대표 결정)
 *
 * 등록:
 *   - 농산물 5개 → 유어밸류 (주) (agricultural)
 *   - 공산품 5개 → 바이와이즈 (주) (industrial)
 *
 * 모두 status='research' 로 시작 (장바구니 상태).
 * supply_type / season_* 컬럼 자동 채움 (ADR-012 D-2, D-5).
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/register-may-products.ts
 */
import { eq, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

interface SeedItem {
  name: string;
  category: string;
  supply_type: 'domestic_vendor' | 'overseas_supplier';
  season_peak_month?: number;
  season_prep_month?: number;
  seasonality_ratio?: number;
  season_score: number;
  description: string;
}

const AGRI_SEEDS: SeedItem[] = [
  {
    name: '블루베리',
    category: '농산물',
    supply_type: 'domestic_vendor',
    season_peak_month: 7,
    season_prep_month: 5,
    seasonality_ratio: 5.0,
    season_score: 5,
    description: '6~7월 피크 시즌. 국내 농가 직거래 — 베리라이스, 청춘목장, 온도농장 매칭됨.',
  },
  {
    name: '납작복숭아',
    category: '농산물',
    supply_type: 'domestic_vendor',
    season_peak_month: 7,
    season_prep_month: 5,
    seasonality_ratio: 8.0,
    season_score: 5,
    description: '영천 별빛촌장터 농가 매칭 (하와수농장, 미소복숭아, 행복한농원). 희소 품종 — 일반 복숭아 대비 시즌성 ↑.',
  },
  {
    name: '옥수수',
    category: '농산물',
    supply_type: 'domestic_vendor',
    season_peak_month: 8,
    season_prep_month: 5,
    seasonality_ratio: 6.0,
    season_score: 5,
    description: '정읍 단풍몰 농가 (고부농산영농조합 — 063-535-0037, 사업자 확인). 7~8월 출하 안정.',
  },
  {
    name: '풋고추',
    category: '농산물',
    supply_type: 'domestic_vendor',
    season_peak_month: 6,
    season_prep_month: 5,
    seasonality_ratio: 4.0,
    season_score: 5,
    description: '충북 음성 농가 풍부 (수정산농원, 음성고추영농조합). 지금이 피크 직전 — 즉시 회전 가능.',
  },
  {
    name: '훈제오리',
    category: '농산물(가공)',
    supply_type: 'domestic_vendor',
    season_peak_month: 6,
    season_prep_month: 5,
    seasonality_ratio: 1.6,
    season_score: 5,
    description: '농협 인증 가공 (농협목우촌, 수비드림). 단가 높아 마진 여유 있음.',
  },
];

const INDUSTRIAL_SEEDS: SeedItem[] = [
  {
    name: '땀패드',
    category: '생활용품',
    supply_type: 'overseas_supplier',
    season_peak_month: 7,
    season_prep_month: 5,
    seasonality_ratio: 46.1,
    season_score: 5,
    description: '시즌성 46배 — 여름 직전 폭발적 증가. 1688 풍부, 객단가 1.5만, 마진 ↑ 강력.',
  },
  {
    name: '곤약면',
    category: '식품',
    supply_type: 'overseas_supplier',
    season_peak_month: 7,
    season_prep_month: 5,
    seasonality_ratio: 3.4,
    season_score: 5,
    description: '다이어트 6~8월 시즌. 1688 식품 도매 적합, 저관세, 보관 안정.',
  },
  {
    name: '고글',
    category: '레저',
    supply_type: 'overseas_supplier',
    season_peak_month: 7,
    season_prep_month: 5,
    seasonality_ratio: 1.6,
    season_score: 5,
    description: '여름 수영장/물놀이 시즌. 1688 풍부, 객단가 2~5만원.',
  },
  {
    name: '러닝용품',
    category: '스포츠',
    supply_type: 'overseas_supplier',
    season_peak_month: 6,
    season_prep_month: 5,
    seasonality_ratio: 2.2,
    season_score: 5,
    description: '봄/여름 운동 시즌. 다양한 SKU 가능 (밴드, 양말, 의류 등).',
  },
  {
    name: '로션',
    category: '화장품',
    supply_type: 'overseas_supplier',
    season_peak_month: 6,
    season_prep_month: 5,
    seasonality_ratio: 1.7,
    season_score: 5,
    description: '6월 화장품 회전 ↑. 1688 화장품 도매 풍부, 마진 60%+.',
  },
];

interface Registered {
  id: string;
  code: string;
  name: string;
  category: string;
}

async function registerForCompany(
  companyId: string,
  companyName: string,
  seeds: SeedItem[],
): Promise<Registered[]> {
  const out: Registered[] = [];
  for (const s of seeds) {
    const code = await suggestNextProductCode(companyId);
    const created = await withCompanyContext(companyId, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          company_id: companyId,
          code,
          name: s.name,
          category: s.category,
          status: 'research',
          description: s.description,
          supply_type: s.supply_type,
          season_peak_month: s.season_peak_month ?? null,
          season_prep_month: s.season_prep_month ?? null,
          seasonality_ratio: s.seasonality_ratio?.toString() ?? null,
          season_score: s.season_score ?? null,
        })
        .returning({ id: products.id, code: products.code, name: products.name });
      return row;
    });
    out.push({
      id: created!.id,
      code: created!.code,
      name: created!.name,
      category: s.category,
    });
    console.log(`  ✅ [${companyName}] ${created!.code} — ${created!.name}`);
  }
  return out;
}

(async () => {
  console.log('=== 5월 추천 상품 일괄 등록 ===\n');

  // 유어밸류 (agricultural) — 농산물
  const agriRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'agricultural'));
  const agriCompany = agriRows[0];
  if (!agriCompany) throw new Error('agricultural 회사 없음');
  console.log(`📂 농산물 5개 → ${agriCompany.name}`);
  const agriRegistered = await registerForCompany(
    agriCompany.id,
    agriCompany.name,
    AGRI_SEEDS,
  );

  // 바이와이즈 (industrial) — 공산품
  const indRows = await db
    .select()
    .from(companies)
    .where(eq(companies.business_type, 'industrial'));
  // 바이와이즈 (주) — 가장 첫 industrial
  const indCompany = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0];
  if (!indCompany) throw new Error('industrial 회사 없음');
  console.log(`\n📂 공산품 5개 → ${indCompany.name}`);
  const indRegistered = await registerForCompany(
    indCompany.id,
    indCompany.name,
    INDUSTRIAL_SEEDS,
  );

  // 결과 요약
  console.log('\n\n===== 등록 결과 =====\n');
  console.log(`총 ${agriRegistered.length + indRegistered.length}개 등록\n`);
  console.log(`## 농산물 (${agriCompany.name})`);
  for (const r of agriRegistered) {
    console.log(`- ${r.code} ${r.name} — http://localhost:3002/products/${r.id}`);
  }
  console.log(`\n## 공산품 (${indCompany.name})`);
  for (const r of indRegistered) {
    console.log(`- ${r.code} ${r.name} — http://localhost:3002/products/${r.id}`);
  }

  // 통계 확인
  console.log(`\n\n===== 회사별 research 단계 상품 개수 =====`);
  for (const co of [agriCompany, indCompany]) {
    const [cnt] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(products)
      .where(sql`${products.company_id} = ${co.id} AND ${products.status} = 'research'`);
    console.log(`  ${co.name}: ${cnt?.c ?? 0}개`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error('실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
