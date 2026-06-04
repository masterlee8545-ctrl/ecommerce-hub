import { saveSellochomesCookie } from '../src/lib/sellochomes/client';

const COOKIE = process.argv[2];
if (!COOKIE) {
  console.error('사용법: tsx scripts/save-sello-cookie.ts <쿠키값>');
  process.exit(1);
}

(async () => {
  await saveSellochomesCookie(COOKIE);
  console.log('✅ 쿠키 저장 완료 (길이:', COOKIE.length, ')');
  process.exit(0);
})().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
