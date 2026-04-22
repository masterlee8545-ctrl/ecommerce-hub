#!/usr/bin/env node
/**
 * ItemScout API 원본 응답을 덤프해서 "6개월 판매량" 같은 필드가
 * 실제로 내려오는지 확인하는 일회성 스크립트.
 *
 * 사용법: tsx scripts/probe-itemscout-fields.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://api.itemscout.io/api';

async function token(): Promise<string> {
  try {
    const raw = await readFile(join(process.cwd(), '.data', 'itemscout-token.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { token?: string };
    if (parsed.token) return parsed.token;
  } catch {
    /* ignore */
  }
  const env = process.env['ITEMSCOUT_TOKEN'];
  if (env) return env;
  throw new Error('토큰 없음');
}

async function call<T>(path: string, opts?: RequestInit): Promise<T> {
  const t = await token();
  const res = await fetch(`${BASE}/${path}`, {
    ...opts,
    headers: { Cookie: `i_token=${t}`, ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

interface Cat { id: number; n?: string; name?: string; lv: number }
interface Sub { id: number; name: string; is_leaf: number; level: number }

(async () => {
  // 1. 대분류에서 "생활용품" 찾기
  const cats = await call<{ data: Cat[][] }>('category/coupang_categories_map');
  const flat = cats.data.flat();
  const saenghwal = flat.find((c) => c.lv === 1 && c.n === '생활용품');
  if (!saenghwal) throw new Error('생활용품 카테고리 없음');
  console.log('[1] 생활용품 id=', saenghwal.id);

  // 2. 생활용품 하위에서 "아기간식"
  const lv2 = await call<{ data: Sub[] }>(`category/${saenghwal.id}/subcategories`);
  const agigansik = lv2.data.find((s) => s.name === '아기간식');
  if (!agigansik) throw new Error('아기간식 없음');
  console.log('[2] 아기간식 id=', agigansik.id, 'is_leaf=', agigansik.is_leaf);

  // 3. 아기간식 하위에서 "유아두유"
  const lv3 = await call<{ data: Sub[] }>(`category/${agigansik.id}/subcategories`);
  const dooyoo = lv3.data.find((s) => s.name === '유아두유');
  if (!dooyoo) {
    console.log('[3] 유아두유 없음, 하위:', lv3.data.slice(0, 20).map((s) => s.name));
    throw new Error('유아두유 없음');
  }
  console.log('[3] 유아두유 id=', dooyoo.id, 'is_leaf=', dooyoo.is_leaf);

  // 4. 유아두유 키워드 데이터 (리프인지 확인 후 호출)
  const leafId = dooyoo.is_leaf === 1 ? dooyoo.id : dooyoo.id;
  const kwRes = await call<{ data: { data: Record<string, unknown> | null } }>(
    `category/${leafId}/data`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const keywordMap = kwRes.data?.data;
  if (!keywordMap) {
    console.log('[4] 키워드 데이터 없음');
    return;
  }

  const keywords = Object.values(keywordMap) as Array<Record<string, unknown>>;
  console.log(`[4] 키워드 총 ${keywords.length}개`);

  // 5. 전 키워드 필드 합집합 + coupang 중첩 필드 합집합 전수 체크
  console.log('\n━━━━━━━━━━━━━━━ 전 키워드 필드 합집합 ━━━━━━━━━━━━━━━');
  const topKeys = new Set<string>();
  const coupangKeys = new Set<string>();
  let haveCoupang = 0;
  for (const kw of keywords) {
    for (const k of Object.keys(kw)) topKeys.add(k);
    const coupang = kw['coupang'] as Record<string, unknown> | null | undefined;
    if (coupang && typeof coupang === 'object') {
      haveCoupang++;
      for (const k of Object.keys(coupang)) coupangKeys.add(k);
    }
  }
  console.log('Top-level 필드:', [...topKeys].sort());
  console.log(`coupang 객체 보유 키워드: ${haveCoupang}/${keywords.length}`);
  console.log('coupang 중첩 필드:', [...coupangKeys].sort());

  // 6. coupang 객체 있는 첫 키워드 전체 덤프
  const kwWithCoupang = keywords.find((kw) => kw['coupang']);
  if (kwWithCoupang) {
    console.log('\n━━━━━━━━━━━━━━━ coupang 객체 샘플 (전체 JSON) ━━━━━━━━━━━━━━━');
    console.log(JSON.stringify(kwWithCoupang, null, 2));
  }

  // 7. 추가 엔드포인트 탐색 — ItemScout UI가 키워드 상세를 열 때 치는 호출 추측
  console.log('\n━━━━━━━━━━━━━━━ 추가 엔드포인트 탐색 ━━━━━━━━━━━━━━━');
  const probeKeyword = '두유';
  const attempts = [
    `keyword/search?q=${encodeURIComponent(probeKeyword)}`,
    `v2/keyword/${encodeURIComponent(probeKeyword)}`,
    `v2/keyword/detail?keyword=${encodeURIComponent(probeKeyword)}`,
    `keyword/${encodeURIComponent(probeKeyword)}/trend`,
    `keyword/${encodeURIComponent(probeKeyword)}/sales`,
    `keyword/${encodeURIComponent(probeKeyword)}/history`,
    `keyword/${encodeURIComponent(probeKeyword)}/monthly`,
    `v2/keyword/trend/${encodeURIComponent(probeKeyword)}`,
    `v2/keyword/history/${encodeURIComponent(probeKeyword)}`,
    `keyword/info?keyword=${encodeURIComponent(probeKeyword)}`,
    `keyword/${encodeURIComponent(probeKeyword)}`,
  ];
  for (const p of attempts) {
    try {
      const t = await token();
      const r = await fetch(`${BASE}/${p}`, { headers: { Cookie: `i_token=${t}` } });
      const bodyText = await r.text();
      const bodyHead = bodyText.slice(0, 200).replace(/\s+/g, ' ');
      console.log(`  [${r.status}] ${p} — ${bodyHead}`);
    } catch (e) {
      console.log(`  [ERR] ${p} — ${(e as Error).message}`);
    }
  }
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
