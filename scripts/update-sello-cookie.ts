/**
 * 셀록홈즈 쿠키 갱신 + 카테고리 endpoint 살아있는지 검증
 */
import { resolveCategoryPath, saveSellochomesCookie } from '../src/lib/sellochomes/client';

const COOKIE = process.argv[2];

(async () => {
  if (!COOKIE) {
    console.error('쿠키 인자 필요');
    process.exit(1);
  }
  console.log(`쿠키 갱신: ${COOKIE.slice(0, 20)}... (len ${COOKIE.length})`);
  await saveSellochomesCookie(COOKIE);
  console.log('✅ DB 저장 완료');

  // 카테고리 API 호출로 살아있는지 검증
  const tree = await resolveCategoryPath('식품');
  console.log(`✅ 카테고리 API OK — queryCategoryId=${tree.queryCategoryId}`);
  process.exit(0);
})().catch((e) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
