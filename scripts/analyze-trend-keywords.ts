/**
 * 거래처가 진입한 키워드 — 왜 선택했는지 분석
 *
 * 대상: 신비복숭아, 세척사과
 * 데이터: 시즌 펄스 + 네이버 블로그/지식인
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import { naverMultiSearch } from '../src/lib/research/naver-search';
import {
  analyzeKeyword,
  getMonthRelevance,
} from '../src/lib/sellochomes/season-analyzer';

const TARGETS = ['신비복숭아', '세척사과'];
const TODAY_MONTH = new Date().getMonth() + 1;

(async () => {
  // 1) 시즌 펄스에서 확인
  console.log('=== 시즌 펄스 분석 ===\n');
  for (const k of TARGETS) {
    const fetched = await db
      .select()
      .from(keywordChartFetches)
      .where(eq(keywordChartFetches.keyword, k));
    if (fetched.length === 0) {
      console.log(`"${k}": 시즌 펄스 데이터 없음 — DB 풀에 미수집 키워드`);
      continue;
    }
    const daily = await db
      .select()
      .from(keywordChartDaily)
      .where(eq(keywordChartDaily.keyword, k));
    const analysis = analyzeKeyword(
      k,
      daily.map((r) => ({ period: r.period, ratio: r.ratio })),
      { window: 'last_year' },
    );
    if (!analysis) {
      console.log(`"${k}": 분석 불가`);
      continue;
    }
    const rel = getMonthRelevance(analysis, TODAY_MONTH);
    console.log(`"${k}" — 시즌 점수 ${rel.score}, 피크 ${analysis.peak_month}월, 시즌성 ${analysis.seasonality_ratio?.toFixed(1)}배`);
    console.log(`  사유: ${rel.reason}`);
  }

  // 2) 네이버 블로그에서 패턴 분석
  console.log('\n=== 네이버 블로그 + 지식인 분석 ===\n');
  for (const k of TARGETS) {
    console.log(`\n### "${k}"`);
    const naver = await naverMultiSearch(k, ['blog', 'kin']);
    const blogItems =
      'items' in (naver.blog ?? {}) ? (naver.blog as { items: Array<{ title: string; description: string; bloggername?: string; postdate?: string }> }).items : [];
    const kinItems =
      'items' in (naver.kin ?? {}) ? (naver.kin as { items: Array<{ title: string; description: string }> }).items : [];

    console.log(`블로그 ${blogItems.length}건 / 지식인 ${kinItems.length}건`);

    // 블로그 글 상위 5개 제목 + 일부 본문
    console.log('\n--- 블로그 상위 5개 ---');
    blogItems.slice(0, 5).forEach((b, i) => {
      console.log(`${i + 1}. ${b.title}`);
      console.log(`   ${b.description.slice(0, 100)}...`);
      console.log(`   by ${b.bloggername ?? '?'} | ${b.postdate ?? '?'}`);
    });

    // 키워드 빈도 분석 (왜 사람들이 사는지 단서)
    const allText = [...blogItems, ...kinItems].map((it) => `${it.title} ${it.description}`).join(' ');
    const interestKeywords = [
      '맛있',
      '달콤',
      '단단',
      '아삭',
      '안전',
      '간편',
      '편리',
      '깨끗',
      '씻',
      '바로',
      '선물',
      '품종',
      '희소',
      '특별',
      '신품종',
      '명품',
      '햇',
      '제철',
      '시즌',
      '농가',
      '직거래',
      '쿠팡',
      '로켓',
      '새벽',
      '배송',
      '아이',
      '아기',
      '간식',
      '디저트',
    ];

    const counts = new Map<string, number>();
    for (const kw of interestKeywords) {
      const matches = allText.match(new RegExp(kw, 'g'));
      if (matches && matches.length > 0) counts.set(kw, matches.length);
    }

    const topKeywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('\n--- 자주 등장하는 키워드 (구매 동기 단서) ---');
    topKeywords.forEach(([w, c]) => console.log(`  ${w}: ${c}회`));
  }

  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
