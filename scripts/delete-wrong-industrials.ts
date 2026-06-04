/**
 * 형 sweet spot 기준 위반 공산품 자동 삭제
 *
 * 삭제 사유:
 *   - 데코타일/시트지 — 부피 큼
 *   - 제모기 — 전자제품
 *   - 러닝용품 — 광범위 키워드
 *   - 모기퇴치기 — 전자 + 한국 시장 특수
 *   - 개미약 — 한국 브랜드 강세
 *   - 고글 — 모호 (수영/스키 구체 X)
 */
import { inArray } from 'drizzle-orm';

import { db } from '../src/db';
import { products } from '../src/db/schema';

const TO_DELETE = ['데코타일', '시트지', '제모기', '러닝용품', '모기퇴치기', '개미약', '고글'];

(async () => {
  const d = await db
    .delete(products)
    .where(inArray(products.name, TO_DELETE))
    .returning({ code: products.code, name: products.name });
  console.log('삭제 완료:');
  d.forEach((r) => console.log(`  ❌ ${r.code} ${r.name}`));
  console.log(`총 ${d.length}개`);
  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
