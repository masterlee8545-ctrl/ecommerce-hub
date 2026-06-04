#!/usr/bin/env node
/**
 * A안 — 형 비중대로 88개 풀 재배치
 *
 * 단계:
 *   1. 신규 30개 (강의 통과 14개 + 큐레이션 16개) 임시 데이터 정의
 *   2. 농산물 매칭 안 된 27개 + 변종 2개 = 29개 삭제 키워드 정의
 *   3. 현재 등록 상품 정보 메모리에 백업 (description/season 등)
 *   4. 모두 삭제 (research 단계)
 *   5. 비중대로 3법인에 새 등록
 *
 * 목표 비중:
 *   - 유어밸류 44개 (공산품 31 + 농산물 13)
 *   - 유어옵티멀 22개 (공산품 11 + 농산물 11)
 *   - 바이와이즈 22개 (공산품 11 + 농산물 11)
 *   - 합계 88개 (공산품 53 + 농산물 35)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import { companies, products } from '../src/db/schema';
import { suggestNextProductCode } from '../src/lib/products/mutations';

interface NewProduct {
  name: string;
  category: string;
  supply_type: 'domestic_vendor' | 'overseas_supplier';
  description: string;
  season_score?: number | null;
  season_peak_month?: number | null;
  season_prep_month?: number | null;
  seasonality_ratio?: string | null;
}

// ─────────────────────────────────────────────────────────
// 신규 30개 — 강의 통과 14개 + 큐레이션 16개
// ─────────────────────────────────────────────────────────
const NEW_INDUSTRIALS: NewProduct[] = [
  // 강의 통과 14개
  { name: '귀마개', category: '의료/위생', supply_type: 'overseas_supplier', description: '[강의 통과] 작음, 1688 풍부, 브랜드 약함' },
  { name: '문어괄사', category: '안마(수동)', supply_type: 'overseas_supplier', description: '[강의 통과] 수동 마사지, 작음, 전자 X' },
  { name: '북커버', category: '사무', supply_type: 'overseas_supplier', description: '[강의 통과] 디자인 차별화 가능' },
  { name: '케이크토퍼', category: '사무/파티', supply_type: 'overseas_supplier', description: '[강의 통과] 이벤트 용품, 1688 풍부' },
  { name: '브라이덜샤워', category: '사무/파티', supply_type: 'overseas_supplier', description: '[강의 통과] 파티 세트' },
  { name: '골프파우치', category: '골프', supply_type: 'overseas_supplier', description: '[강의 통과] 골프 액세서리, 작음' },
  { name: '가습마스크', category: '건강관리', supply_type: 'overseas_supplier', description: '[강의 통과] 10~3월 시즌, 작음', season_score: 5, season_peak_month: 12, season_prep_month: 10 },
  { name: '귀지압패치', category: '건강관리', supply_type: 'overseas_supplier', description: '[강의 통과] 작음, 의료/위생' },
  { name: '하임리히응급키트', category: '의료', supply_type: 'overseas_supplier', description: '[강의 통과] 의료 needs, 작음' },
  { name: '맥세이프스티커', category: '휴대폰액세서리', supply_type: 'overseas_supplier', description: '[강의 통과] 작음, 가성비 진입' },
  { name: '스프링훌라후프', category: '헬스', supply_type: 'overseas_supplier', description: '[강의 통과] 운동, 작음' },
  { name: '밸런스 스톤', category: '헬스', supply_type: 'overseas_supplier', description: '[강의 통과] 균형 운동, 작음' },
  { name: '바풀', category: '헬스', supply_type: 'overseas_supplier', description: '[강의 통과] 작음, 1688 풍부' },
  { name: '등산스틱', category: '등산', supply_type: 'overseas_supplier', description: '[강의 통과] 작은 부피, 1688 가능' },

  // 큐레이션 16개 (형 sweet spot 추가)
  { name: '칫솔홀더', category: '욕실소품', supply_type: 'overseas_supplier', description: '[큐레이션] 욕실 작음, 디자인 차별화' },
  { name: '변기솔', category: '욕실소품', supply_type: 'overseas_supplier', description: '[큐레이션] 욕실 작음, 1688 풍부' },
  { name: '양념통 세트', category: '주방용품', supply_type: 'overseas_supplier', description: '[큐레이션] 주방 작음, 디자인' },
  { name: '미니 도마', category: '주방용품', supply_type: 'overseas_supplier', description: '[큐레이션] 작은 사이즈, 색상 차별화' },
  { name: '펜홀더', category: '사무', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 디자인' },
  { name: '케이블 정리 클립', category: '사무', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 1688 풍부' },
  { name: '옷걸이 세트', category: '수납', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 가성비' },
  { name: '미니 수납박스', category: '수납', supply_type: 'overseas_supplier', description: '[큐레이션] 작은 부피, 컬러' },
  { name: '여권 케이스', category: '여행', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 디자인 차별화' },
  { name: '여행 베개', category: '여행', supply_type: 'overseas_supplier', description: '[큐레이션] U자형, 작음' },
  { name: '수면 안대', category: '여행/수면', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 의료/수면' },
  { name: '펫 빗', category: '반려동물', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 1688 풍부' },
  { name: '펫 발톱깎이', category: '반려동물', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 수동' },
  { name: '핸드그립', category: '헬스', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 운동' },
  { name: '골프공 마커', category: '골프', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 매니아' },
  { name: '골프티', category: '골프', supply_type: 'overseas_supplier', description: '[큐레이션] 작음, 1688 풍부' },
];

// ─────────────────────────────────────────────────────────
// 농산물 삭제 키워드 (매칭 안 됨 27 + 변종 중복 2)
// ─────────────────────────────────────────────────────────
const AGRI_TO_DELETE = [
  // 매칭 안 됨 (27)
  '씨없는수박', '매실', '살구', '미니수박', '수박', '하우스감귤', '앵두', '감귤',
  '백도', '자두', '황도', '망고', '김치', '양배추', '비트', '진미채', '황태채',
  '북어', '다시팩', '명란젓', '새우젓', '갓김치', '묵은지', '포기김치', '열무김치',
  '깻잎장아찌', '매실장아찌',
  // 변종 중복 (2) — 블루베리 메인만 유지
  '생블루베리', '냉동블루베리',
];

(async () => {
  console.log('=== A안 풀 진행 시작 ===\n');

  const agriRows = await db.select().from(companies).where(eq(companies.business_type, 'agricultural'));
  const optRows = await db.select().from(companies).where(eq(companies.business_type, 'other'));
  const indRows = await db.select().from(companies).where(eq(companies.business_type, 'industrial'));
  const agriCo = agriRows[0]!;
  const optCo = optRows[0]!;
  const indCo = indRows.find((c) => c.name.includes('바이와이즈')) ?? indRows[0]!;

  console.log(`회사:`);
  console.log(`  유어밸류 (50%, 공산품 7:3): ${agriCo.id.slice(0, 8)}`);
  console.log(`  유어옵티멀 (25%, 5:5): ${optCo.id.slice(0, 8)}`);
  console.log(`  바이와이즈 (25%, 5:5): ${indCo.id.slice(0, 8)}`);

  // ─── 1. 현재 상품 정보 백업 ───
  const allRows = await db
    .select({
      name: products.name,
      category: products.category,
      description: products.description,
      supply_type: products.supply_type,
      season_score: products.season_score,
      season_peak_month: products.season_peak_month,
      season_prep_month: products.season_prep_month,
      seasonality_ratio: products.seasonality_ratio,
    })
    .from(products)
    .where(eq(products.status, 'research'));
  console.log(`\n현재 등록: ${allRows.length}개`);

  // ─── 2. 삭제 대상 필터링 ───
  const deleteSet = new Set(AGRI_TO_DELETE);
  const keptProducts = allRows.filter((p) => !deleteSet.has(p.name));
  console.log(`삭제 대상 (농산물): ${allRows.length - keptProducts.length}개`);
  console.log(`유지: ${keptProducts.length}개`);

  // ─── 3. 농산물 / 공산품 분리 ───
  const agriProducts = keptProducts.filter((p) => p.supply_type === 'domestic_vendor');
  const indProducts = keptProducts.filter((p) => p.supply_type === 'overseas_supplier');
  console.log(`  농산물 ${agriProducts.length} / 공산품 ${indProducts.length}`);

  // ─── 4. 신규 30개 추가 (공산품) ───
  const newIndNames = new Set(NEW_INDUSTRIALS.map((p) => p.name));
  const existingIndNames = new Set(indProducts.map((p) => p.name));
  const trulyNew = NEW_INDUSTRIALS.filter((p) => !existingIndNames.has(p.name));
  console.log(`\n신규 공산품 추가: ${trulyNew.length}개 (이미 ${NEW_INDUSTRIALS.length - trulyNew.length}개 중복)`);

  const allIndustrials = [...indProducts.map((p) => ({
    name: p.name,
    category: p.category ?? '생활용품',
    supply_type: 'overseas_supplier' as const,
    description: p.description ?? '',
    season_score: p.season_score,
    season_peak_month: p.season_peak_month,
    season_prep_month: p.season_prep_month,
    seasonality_ratio: p.seasonality_ratio,
  })), ...trulyNew];

  console.log(`\n최종:`);
  console.log(`  공산품: ${allIndustrials.length}개`);
  console.log(`  농산물: ${agriProducts.length}개`);
  console.log(`  합계: ${allIndustrials.length + agriProducts.length}개`);

  // ─── 5. 비중대로 분배 ───
  // 유어밸류 50% (공산품 70 : 농산물 30)
  // 유어옵티멀 25% (5:5)
  // 바이와이즈 25% (5:5)
  const total = allIndustrials.length + agriProducts.length;
  const yvTotal = Math.floor(total * 0.5);
  const yoTotal = Math.floor(total * 0.25);
  const bwTotal = total - yvTotal - yoTotal;

  const yvInd = Math.floor(yvTotal * 0.7);
  const yvAgri = yvTotal - yvInd;
  const yoInd = Math.floor(yoTotal * 0.5);
  const yoAgri = yoTotal - yoInd;
  const bwInd = Math.floor(bwTotal * 0.5);
  const bwAgri = bwTotal - bwInd;

  console.log(`\n분배 목표:`);
  console.log(`  유어밸류 ${yvTotal}개 (공산품 ${yvInd}, 농산물 ${yvAgri})`);
  console.log(`  유어옵티멀 ${yoTotal}개 (공산품 ${yoInd}, 농산물 ${yoAgri})`);
  console.log(`  바이와이즈 ${bwTotal}개 (공산품 ${bwInd}, 농산물 ${bwAgri})`);

  // 공산품 / 농산물 셔플 + 분배
  function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  const shuffledInd = shuffle(allIndustrials);
  const shuffledAgri = shuffle(agriProducts);

  // 분배
  const indForYv = shuffledInd.slice(0, yvInd);
  const indForYo = shuffledInd.slice(yvInd, yvInd + yoInd);
  const indForBw = shuffledInd.slice(yvInd + yoInd, yvInd + yoInd + bwInd);

  const agriForYv = shuffledAgri.slice(0, yvAgri);
  const agriForYo = shuffledAgri.slice(yvAgri, yvAgri + yoAgri);
  const agriForBw = shuffledAgri.slice(yvAgri + yoAgri, yvAgri + yoAgri + bwAgri);

  // ─── 6. 기존 모두 삭제 ───
  console.log(`\n=== 기존 ${allRows.length}개 삭제 ===`);
  const deleted = await db
    .delete(products)
    .where(eq(products.status, 'research'))
    .returning({ id: products.id });
  console.log(`  삭제: ${deleted.length}개`);

  // ─── 7. 새로 등록 ───
  async function insertBatch(co: typeof agriCo, list: typeof allIndustrials) {
    let count = 0;
    for (const item of list) {
      const code = await suggestNextProductCode(co.id);
      await withCompanyContext(co.id, async (tx) => {
        await tx.insert(products).values({
          company_id: co.id,
          code,
          name: item.name,
          category: item.category,
          status: 'research',
          description: item.description,
          supply_type: item.supply_type,
          season_score: item.season_score ?? null,
          season_peak_month: item.season_peak_month ?? null,
          season_prep_month: item.season_prep_month ?? null,
          seasonality_ratio: item.seasonality_ratio,
        });
      });
      count++;
    }
    return count;
  }

  console.log(`\n=== 새 등록 ===`);
  const yvIndCount = await insertBatch(agriCo, indForYv);
  const yvAgriCount = await insertBatch(agriCo, agriForYv);
  console.log(`  유어밸류: 공산품 ${yvIndCount} + 농산물 ${yvAgriCount} = ${yvIndCount + yvAgriCount}`);

  const yoIndCount = await insertBatch(optCo, indForYo);
  const yoAgriCount = await insertBatch(optCo, agriForYo);
  console.log(`  유어옵티멀: 공산품 ${yoIndCount} + 농산물 ${yoAgriCount} = ${yoIndCount + yoAgriCount}`);

  const bwIndCount = await insertBatch(indCo, indForBw);
  const bwAgriCount = await insertBatch(indCo, agriForBw);
  console.log(`  바이와이즈: 공산품 ${bwIndCount} + 농산물 ${bwAgriCount} = ${bwIndCount + bwAgriCount}`);

  // ─── 통계 ───
  console.log(`\n=== 최종 통계 ===`);
  for (const co of [agriCo, optCo, indCo]) {
    const [cnt] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.company_id, co.id), eq(products.status, 'research')));
    console.log(`  ${co.name}: ${cnt?.c ?? 0}개`);
  }
  process.exit(0);
})().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
