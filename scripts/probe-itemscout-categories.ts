#!/usr/bin/env node
/**
 * ItemScout categories_map 응답에서 "식품" 카테고리 중복 여부 확인.
 * - 쿠팡 전용 필드(platform)가 있는지
 * - 같은 이름 n='식품' 이 중복되는지
 * - subcategories(id=식품 후보 id) 호출 결과가 실제로 식품 하위인지
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://api.itemscout.io/api';

async function token(): Promise<string> {
  try {
    const raw = await readFile(join(process.cwd(), '.data', 'itemscout-token.json'), 'utf-8');
    return (JSON.parse(raw) as { token?: string }).token ?? '';
  } catch {
    return process.env['ITEMSCOUT_TOKEN'] ?? '';
  }
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

interface Cat {
  id: number;
  n: string;
  lv: number;
  cid?: number;
  il?: number;
  ib?: number;
  platform?: number | string;
  [k: string]: unknown;
}

(async () => {
  const res = await call<{ data: Cat[][] | Cat[] }>('category/coupang_categories_map');
  console.log('응답 data 구조:', Array.isArray(res.data) ? 'array' : typeof res.data);
  if (Array.isArray(res.data)) {
    console.log('outer length:', res.data.length);
    for (let i = 0; i < res.data.length; i++) {
      const inner = res.data[i];
      if (Array.isArray(inner)) {
        console.log(`  [${i}] inner array, length=${inner.length}`);
        if (inner.length > 0) {
          const sample = inner[0];
          console.log(`      sample[0]:`, JSON.stringify(sample));
        }
      } else {
        console.log(`  [${i}] scalar:`, JSON.stringify(inner).slice(0, 200));
      }
    }
  }

  // flat
  const flat = (Array.isArray(res.data) ? res.data : []).flat() as Cat[];
  console.log('\n[flat] 총 개수:', flat.length);

  // lv 분포
  const lvCounts: Record<number, number> = {};
  for (const c of flat) lvCounts[c.lv] = (lvCounts[c.lv] ?? 0) + 1;
  console.log('[lv 분포]', lvCounts);

  // lv=1 대분류 전부
  const lv1 = flat.filter((c) => c.lv === 1);
  console.log(`\n[lv=1 대분류 총 ${lv1.length}개]`);
  for (const c of lv1) {
    console.log(`  id=${c.id.toString().padStart(4)}  n="${c.n}"  cid=${c.cid}  il=${c.il}  ` +
      (c.platform !== undefined ? `platform=${c.platform}` : ''));
  }

  // "식품" 이름이 몇 개 있는지
  const sigpum = flat.filter((c) => c.n === '식품');
  console.log(`\n[n="식품" 매칭 ${sigpum.length}개]`);
  for (const c of sigpum) {
    console.log(`  lv=${c.lv} id=${c.id} cid=${c.cid} il=${c.il}`);
  }

  // 대분류 15개 전부의 subcategories 상위 3개 출력 — id → 실제 하위 매칭 점검
  console.log('\n━━━━━━━━━━━━━ 15개 대분류 각각의 subcategories 상위 3개 ━━━━━━━━━━━━━');
  for (const c of lv1) {
    try {
      const subs = await call<{ data: Array<{ id: number; name: string }> }>(
        `category/${c.id}/subcategories`,
      );
      const top = (subs.data ?? []).slice(0, 3).map((s) => s.name).join(', ');
      console.log(`  id=${c.id.toString().padStart(3)} n="${c.n}" → ${top}`);
    } catch (e) {
      console.log(`  id=${c.id} n="${c.n}" → ERROR ${(e as Error).message}`);
    }
  }

  // cid 기준으로도 시도 — 실제 ItemScout이 id가 아닌 cid(플랫폼 id) 를 받을 가능성
  console.log('\n━━━━━━━━━━━━━ cid 기준으로 호출 테스트 (식품=59258, 가전디지털=62588) ━━━━━━━━━━━━━');
  for (const testId of [59258, 62588]) {
    try {
      const subs = await call<{ data: Array<{ id: number; name: string }> }>(
        `category/${testId}/subcategories`,
      );
      const top = (subs.data ?? []).slice(0, 3).map((s) => s.name).join(', ');
      console.log(`  cid=${testId} → ${top}`);
    } catch (e) {
      console.log(`  cid=${testId} → ERROR ${(e as Error).message}`);
    }
  }
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
