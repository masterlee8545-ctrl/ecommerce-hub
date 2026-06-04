/**
 * 대분류 4개 트리 확인 (rate limit 회피용 sleep 추가)
 */
import { resolveCategoryPath } from '../src/lib/sellochomes/client';

const ROOTS = ['가구/인테리어', '생활/건강', '여가/생활편의', '스포츠/레저'];

(async () => {
  for (const r of ROOTS) {
    try {
      const tree = await resolveCategoryPath(r);
      console.log(`\n=== ${r} (id=${tree.queryCategoryId}) ===`);
      for (const [level, data] of Object.entries(tree.setCategory_Info)) {
        const items = data?.catelist ?? [];
        if (items.length === 0) continue;
        console.log(`  [L${level}] ${data.reps ?? ''}`);
        for (const item of items.slice(0, 30)) {
          console.log(`    - ${item.name} (${item.cate_id})`);
        }
      }
    } catch (e) {
      console.log(`\n[${r}] 실패: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.exit(0);
})().catch((e) => {
  console.error('치명적:', e);
  process.exit(1);
});
