#!/usr/bin/env node
/**
 * runSelloScrape() 함수를 직접 호출해서 실시간 스크래핑 동작 확인.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/probe-realtime-scrape.ts [키워드]
 *
 * 주의:
 *   - 실행 중 Chrome 창 모두 닫혀 있어야 함
 *   - BUYWISE sello:scrape 동시 실행 금지
 */
import { runSelloScrape } from '../src/lib/sello-scraper/run-scrape';

const keyword = process.argv[2] ?? '사과';
const modeArg = process.argv[3] as 'visible' | 'minimized' | 'offscreen' | 'headless' | undefined;

(async () => {
  console.log(`[probe] 시작: "${keyword}" mode=${modeArg ?? '(default)'}`);
  const startedAt = Date.now();

  const result = await runSelloScrape(keyword, {
    ...(modeArg ? { mode: modeArg } : {}),
    onProgress: (msg) => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  [${elapsed}s] ${msg}`);
    },
  });

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n[probe] 완료 (${elapsed}s)`);
  if (result.ok) {
    console.log(`  ✓ keyword: ${result.json.keyword}`);
    console.log(`  ✓ rowCount: ${result.json.rowCount}`);
    console.log(`  ✓ filledCount: ${result.json.filledCount}`);
    console.log(`  ✓ jsonPath: ${result.jsonPath}`);
    console.log(`  ✓ 첫 3개 상품:`);
    for (const r of result.json.rows.slice(0, 3)) {
      console.log(`    #${r.rank} ${r.price} | ${(r.name ?? '').slice(0, 30)}`);
    }
    process.exit(0);
  } else {
    console.error(`  ✗ reason: ${result.reason}`);
    console.error(`  ✗ error: ${result.error}`);
    process.exit(1);
  }
})().catch((e: unknown) => {
  console.error('[probe] 크래시:', e instanceof Error ? e.stack : String(e));
  process.exit(2);
});
