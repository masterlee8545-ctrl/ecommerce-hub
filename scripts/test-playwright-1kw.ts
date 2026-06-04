import { chromium } from 'playwright';

(async () => {
  const ctx = await chromium.launchPersistentContext(
    'C:\\Users\\pc\\AppData\\Local\\Google\\Chrome\\User Data',
    {
      headless: false,
      viewport: null,
      args: [
        '--profile-directory=Default',
        '--no-default-browser-check',
        '--no-first-run',
        '--restore-last-session=false',
        '--start-maximized',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    },
  );
  const page = (await ctx.pages())[0] ?? (await ctx.newPage());

  const seenUrls: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('sellochomes')) seenUrls.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword/?keyword=도장', {
    waitUntil: 'load',
    timeout: 30000,
  });
  console.log(`URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);

  // 10초 더 기다림 — SPA hydration
  await page.waitForTimeout(10000);
  console.log(`\n10초 후 URL: ${page.url()}`);
  const html = await page.content();
  console.log(`HTML 길이: ${html.length}`);
  const isLogin = html.includes('로그인') && html.length < 50000;
  console.log(`로그인 페이지로 redirect? ${isLogin}`);

  const inputs = await page.$$eval('input', (els) => els.length);
  console.log(`input 개수: ${inputs}`);

  console.log(`\n셀록홈즈 호출 ${seenUrls.length}개:`);
  seenUrls.slice(0, 20).forEach((u) => console.log(`  ${u}`));

  console.log('\n10초 후 종료...');
  await page.waitForTimeout(10000);
  await ctx.close();
  process.exit(0);
})().catch((e) => {
  console.error('치명적:', e instanceof Error ? e.message : e);
  process.exit(1);
});
