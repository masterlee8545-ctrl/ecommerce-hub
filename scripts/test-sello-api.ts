/**
 * 검색 시퀀스 — POST 가 진짜 trigger
 * 1) POST /usage-count/coupang-keyword/?keyword=X&first=true  (검색 trigger)
 * 2) POST /keyword-caching/recent                              (데이터 조회)
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { systemSettings } from '../src/db/schema';

const KW = process.argv[2] ?? '메모리폼 목베개';

const COOKIES = {
  _ga: 'GA1.1.1450049607.1774702885',
  sourcinglife_visitor_id:
    'guest_48674b7920c304cc5f095f081884b1ebe5980f833ecb905d59ad836097065ecf',
};

function yyyymmdd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  const row = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, 'sellochomes_cookie'))
    .limit(1);
  const sid = row[0]!.value;
  const cookieHeader = Object.entries({ ...COOKIES, 'connect.sid': sid })
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const baseHeaders = {
    cookie: cookieHeader,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ko,en-US;q=0.9,en;q=0.8',
    origin: 'https://sellochomes.co.kr',
    referer: `https://sellochomes.co.kr/sellerlife/coupang-analysis-keyword/?keyword=${encodeURIComponent(KW)}&page=1`,
    dnt: '1',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  };

  console.log(`키워드: ${KW}`);

  // [1] POST usage-count (검색 trigger)
  const triggerUrl = `https://sellochomes.co.kr/api/v1/usage-count/coupang-keyword/?keyword=${encodeURIComponent(KW)}&first=true`;
  console.log(`\n[1] POST trigger`);
  const t = await fetch(triggerUrl, { method: 'POST', headers: baseHeaders });
  console.log(`    상태: ${t.status}, 응답: ${(await t.text()).slice(0, 200)}`);

  // [2] keyword-caching/recent 폴링
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const body = JSON.stringify([
    {
      category: 'coupang-analysis-keyword',
      keyword: KW,
      startDate: yyyymmdd(yesterday),
      endDate: yyyymmdd(today),
    },
  ]);

  for (let attempt = 1; attempt <= 15; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await fetch('https://sellochomes.co.kr/api/v1/keyword-caching/recent', {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': 'application/json' },
      body,
    });
    const arr = (await r.json()) as Array<{
      data?: { coupang?: { shoppingList?: unknown[]; totalCnt?: number; avgReviewCnt?: string } };
    } | null>;
    const first = arr[0];
    if (first?.data) {
      const cp = first.data.coupang;
      console.log(
        `  ✅ ${attempt}회차 (${attempt * 1.5}초): shoppingList=${cp?.shoppingList?.length ?? 0}, totalCnt=${cp?.totalCnt}, avgReview=${cp?.avgReviewCnt}`,
      );
      process.exit(0);
    }
    console.log(`  [${attempt}] ${(attempt * 1.5).toFixed(1)}초: null`);
  }
  console.log(`\n❌ 22초 폴링 실패`);
  process.exit(1);
})();
