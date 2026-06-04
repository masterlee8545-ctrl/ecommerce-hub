/**
 * BEST 픽 농산물/수산물 키워드 → vendors DB 매칭
 * 사용: npx tsx --env-file=.env.local scripts/match-agri-vendors.ts
 */
import { or, like, sql } from 'drizzle-orm';

import { db } from '../src/db';
import { vendors } from '../src/db/schema';

interface KW {
  label: string;
  patterns: string[];
}

const TARGETS: KW[] = [
  { label: '🍉 흑수박', patterns: ['흑수박', '수박'] },
  { label: '🍈 성주참외', patterns: ['성주', '참외'] },
  { label: '🍑 비파열매', patterns: ['비파'] },
  { label: '🌿 다래순', patterns: ['다래순', '다래'] },
  { label: '🍊 카라향(감귤)', patterns: ['카라', '카라카라', '감귤'] },
  { label: '🍎 사과', patterns: ['사과'] },
  { label: '🦐 미더덕회', patterns: ['미더덕'] },
  { label: '🦑 무늬오징어', patterns: ['무늬오징어', '오징어'] },
  { label: '🌱 두릅(장아찌)', patterns: ['두릅'] },
  { label: '🧅 양파(김치)', patterns: ['양파'] },
];

(async () => {
  for (const t of TARGETS) {
    const orConds = t.patterns.flatMap((p) => [
      like(vendors.product_keywords_all, `%${p}%`),
      like(vendors.products_top10, `%${p}%`),
      like(vendors.biz_name, `%${p}%`),
    ]);

    const matched = await db
      .select({
        id: vendors.id,
        biz_name: vendors.biz_name,
        biz_owner_name: vendors.biz_owner_name,
        repr_tel_no: vendors.repr_tel_no,
        biz_mobile: vendors.biz_mobile,
        biz_address: vendors.biz_address,
        products_top10: vendors.products_top10,
        classification: vendors.classification,
        source_site: vendors.source_site,
        work_status: vendors.work_status,
      })
      .from(vendors)
      .where(or(...orConds))
      .limit(10);

    const total = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(vendors)
      .where(or(...orConds));

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${t.label}  →  ${total[0]?.n ?? 0}개 매칭`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (matched.length === 0) {
      console.log(`  ❌ 매칭 농가 없음 — 외부 발굴 필요 (네이버/카카오 검색)`);
      continue;
    }
    matched.slice(0, 5).forEach((v, i) => {
      const status = v.work_status === 'active' ? '✓' : `[${v.work_status}]`;
      const phone = v.repr_tel_no ?? v.biz_mobile ?? '-';
      const addr = v.biz_address?.slice(0, 30) ?? '-';
      const products = v.products_top10?.slice(0, 60) ?? '-';
      console.log(
        `  ${i + 1}. ${status} ${v.biz_name} (${v.biz_owner_name ?? '-'}) [${v.classification ?? '-'}]`,
      );
      console.log(`     📞 ${phone} | 📍 ${addr}`);
      console.log(`     상품: ${products}`);
      console.log(`     출처: ${v.source_site}`);
    });
  }
  process.exit(0);
})().catch((e) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
