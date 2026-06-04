#!/usr/bin/env node
/**
 * 등록 상품 → 쿠팡 1페이지 메트릭 자동 평가 (형 진입 기준 v2)
 *
 * 형 진입 기준 (정정됨):
 *   - 평균 리뷰 300~500 이하 = 진입 가능
 *   - 로켓 비중 무관
 *   - 가격대 1~10만원
 *   - 1위 브랜드 무관
 *   - 핵심 제외: 화장품/건기식/전자제품 같은 쌘 경쟁사 카테고리
 *
 * 등급:
 *   S = 평균 리뷰 < 100 (블루오션)
 *   A = 평균 리뷰 100~300 (진입 가능, 안전)
 *   B = 평균 리뷰 300~500 (진입 가능, 조심)
 *   C = 평균 리뷰 > 500 (포화 — 진입 어려움)
 *   ? = 캐시 없음 (스크래핑 필요)
 */
import { eq, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';
import { getCoupangFirstPageMetrics } from '../src/lib/sello-scraper/metrics';

interface ProductEval {
  code: string;
  name: string;
  grade: 'S' | 'A' | 'B' | 'C' | '?';
  avgReviews: number | null;
  rocketRatio: number | null;
  rowCount: number | null;
  reason: string;
}

function evaluate(metrics: Awaited<ReturnType<typeof getCoupangFirstPageMetrics>>): {
  grade: ProductEval['grade'];
  reason: string;
  avg: number | null;
} {
  if (!metrics || metrics.rowCount === 0) {
    return { grade: '?', reason: '쿠팡 캐시 없음 (스크래핑 필요)', avg: null };
  }
  const reviews = metrics.reviews.map((r) => r.reviewCount).filter((n) => n >= 0);
  if (reviews.length === 0) {
    return { grade: '?', reason: '리뷰 데이터 없음', avg: null };
  }
  const sum = reviews.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / reviews.length);
  const rocketPct = Math.round(metrics.rocketRatio * 100);

  // 형 기준 v2: 평균 리뷰만 보면 됨, 로켓 무관
  if (avg < 100) {
    return { grade: 'S', reason: `평균 리뷰 ${avg} (블루오션, 로켓 ${rocketPct}%)`, avg };
  }
  if (avg < 300) {
    return { grade: 'A', reason: `평균 리뷰 ${avg} (진입 안전, 로켓 ${rocketPct}%)`, avg };
  }
  if (avg < 500) {
    return { grade: 'B', reason: `평균 리뷰 ${avg} (진입 가능, 로켓 ${rocketPct}%)`, avg };
  }
  return { grade: 'C', reason: `평균 리뷰 ${avg} (포화, 로켓 ${rocketPct}%)`, avg };
}

(async () => {
  const rows = await db
    .select({ id: products.id, code: products.code, name: products.name })
    .from(products)
    .where(eq(products.status, 'research'));

  console.log(`평가 대상: ${rows.length}개 상품\n`);

  const evals: ProductEval[] = [];
  for (const r of rows) {
    const metrics = await getCoupangFirstPageMetrics(r.name);
    const { grade, reason, avg } = evaluate(metrics);
    evals.push({
      code: r.code,
      name: r.name,
      grade,
      avgReviews: avg,
      rocketRatio: metrics?.rocketRatio ?? null,
      rowCount: metrics?.rowCount ?? null,
      reason,
    });
  }

  // 등급별 그룹
  const byGrade: Record<string, ProductEval[]> = { S: [], A: [], B: [], C: [], '?': [] };
  for (const e of evals) byGrade[e.grade]!.push(e);

  console.log('===== 형 진입 기준 자동 평가 =====\n');
  console.log(`S (블루오션):       ${byGrade['S']!.length}개`);
  console.log(`A (진입 가능):      ${byGrade['A']!.length}개`);
  console.log(`B (검토 필요):      ${byGrade['B']!.length}개`);
  console.log(`C (포화):           ${byGrade['C']!.length}개`);
  console.log(`? (캐시 없음):      ${byGrade['?']!.length}개`);
  console.log('');

  for (const grade of ['S', 'A', 'B', 'C'] as const) {
    if (byGrade[grade]!.length === 0) continue;
    console.log(`\n## ${grade}등급`);
    for (const e of byGrade[grade]!) {
      console.log(`  ${e.code} ${e.name} — ${e.reason}`);
    }
  }

  if (byGrade['?']!.length > 0) {
    console.log(`\n## ? (스크래핑 필요)`);
    console.log(`  ${byGrade['?']!.map((e) => e.name).join(', ')}`);
    console.log(`\n  → 쿠팡 캐시 채우려면: npm run sello:scrape 같은 명령어 실행 (별도)`);
  }

  process.exit(0);
})().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
