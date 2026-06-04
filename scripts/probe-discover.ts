import { discoverExternalVendors } from '../src/lib/research/external-vendor-discover';

(async () => {
  console.log('검색: "고체 탈취제"');
  const result = await discoverExternalVendors('고체 탈취제');
  console.log('네이버 hits:', result.naverHits);
  console.log('브랜드 후보:', result.brandCandidates);
  console.log('카드 수:', result.candidates.length);
  result.candidates.slice(0, 5).forEach((c, i) => {
    console.log(`${i + 1}. ${c.bizName} (${c.confidence})`);
    console.log(`   ☎ ${c.phone || '-'}`);
    console.log(`   📍 ${c.address || '-'}`);
    console.log(`   출처: ${c.sourceTitle.slice(0, 60)}`);
  });
  process.exit(0);
})().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
