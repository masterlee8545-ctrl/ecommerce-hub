/**
 * 매칭 0 농수산물 5개 외부 도매처 발굴
 *   각 키워드 × 2~3개 쿼리 (지역/산지 조합)
 *   결과: 후보 카드 + 카카오 검증 (전화/주소)
 */
import { discoverExternalVendors } from '../src/lib/research/external-vendor-discover';

interface Target {
  label: string;
  queries: string[];
}

const TARGETS: Target[] = [
  {
    label: '🍉 흑수박',
    queries: ['흑수박 농가', '흑수박 산지', '함안 흑수박'],
  },
  {
    label: '🍑 비파열매',
    queries: ['비파열매 농가', '제주 비파', '남해 비파열매'],
  },
  {
    label: '🍊 카라향 (카라카라)',
    queries: ['카라카라 농가', '카라향 농장', '제주 카라카라'],
  },
  {
    label: '🦐 미더덕',
    queries: ['미더덕 도매', '마산 미더덕', '창원 미더덕'],
  },
  {
    label: '🦑 무늬오징어',
    queries: ['무늬오징어 도매', '제주 무늬오징어', '동해 무늬오징어'],
  },
];

(async () => {
  for (const t of TARGETS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${t.label}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 중복 제거용 (전화번호 기준)
    const seenPhones = new Set<string>();
    const merged: Array<{
      bizName: string;
      phone: string | null;
      address: string | null;
      categoryName: string | null;
      placeUrl: string | null;
      sourceTitle: string;
      sourceUrl: string;
      confidence: string;
      fromQuery: string;
    }> = [];

    let totalBrands = 0;
    for (const q of t.queries) {
      try {
        const r = await discoverExternalVendors(q);
        totalBrands += r.brandCandidates.length;
        for (const c of r.candidates) {
          const key = c.phone ?? c.bizName;
          if (seenPhones.has(key)) continue;
          seenPhones.add(key);
          merged.push({ ...c, fromQuery: q });
        }
        console.log(
          `  쿼리 "${q}": 블로그 ${r.naverHits.blog}건, 지식인 ${r.naverHits.kin}건, 브랜드 ${r.brandCandidates.length}개, 후보 ${r.candidates.length}개`,
        );
      } catch (e) {
        console.warn(`  쿼리 "${q}" 실패: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // 농가/도매 관련 카테고리만 필터링
    const EXCLUDE_CAT = [
      '음식점', '카페', '술집', '호프', '낚시', '숙박', '한옥',
      '부동산', '주거시설', '아파트', '공원', '관광,명소',
      '단체', '협회', '학원', '주차',
      '반려동물', '의류', '미용',
    ];
    const isGood = (cat: string | null) => {
      if (!cat) return false;
      return !EXCLUDE_CAT.some((w) => cat.includes(w));
    };
    const filtered = merged.filter((c) => isGood(c.categoryName) && c.phone);

    console.log(`\n  ➜ 후보 ${merged.length}개 / 농가·도매 카테고리 + 전화 있음: ${filtered.length}개`);
    if (filtered.length === 0) {
      console.log(`  ❌ 필터 통과 후보 0개 — merged 상위 3개라도 표시:`);
      merged.slice(0, 3).forEach((c, i) => {
        console.log(`     ${i + 1}. ${c.bizName} [${c.categoryName ?? '-'}] ${c.phone ?? '-'}`);
      });
      continue;
    }

    filtered.slice(0, 10).forEach((c, i) => {
      console.log(`\n  ${i + 1}. ${c.bizName} [${c.confidence}]`);
      console.log(`     📞 ${c.phone ?? '-'}`);
      console.log(`     📍 ${c.address ?? '-'}`);
      console.log(`     카테고리: ${c.categoryName ?? '-'}`);
      console.log(`     출처: "${c.sourceTitle.slice(0, 50)}" (쿼리: ${c.fromQuery})`);
    });
  }

  console.log(`\n=== 완료 ===`);
  process.exit(0);
})().catch((e) => {
  console.error('치명적:', e instanceof Error ? e.message : e);
  process.exit(1);
});
