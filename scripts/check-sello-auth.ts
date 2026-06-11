/**
 * 셀록홈즈 쿠키 유효성 단독 점검 — 카테고리 API (인증 필수) 호출
 */
import { SellochomesError, resolveCategoryPath } from '../src/lib/sellochomes/client';

(async () => {
  try {
    const tree = await resolveCategoryPath('식품');
    console.log(`✅ 쿠키 유효 — 카테고리 API OK (queryCategoryId=${tree.queryCategoryId})`);
    process.exit(0);
  } catch (e) {
    if (e instanceof SellochomesError) {
      console.log(`❌ ${e.code}: ${e.message}`);
    } else {
      console.log(`❌ ${e instanceof Error ? e.message : e}`);
    }
    process.exit(1);
  }
})();
