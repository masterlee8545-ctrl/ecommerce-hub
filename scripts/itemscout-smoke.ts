#!/usr/bin/env node
/**
 * ItemScout API 스모크 테스트 — 라벨/ID 매핑 회귀 감지용.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/itemscout-smoke.ts
 *
 * 검사 항목:
 * 1. 15개 대분류가 반환되는지 (이전에는 16개였을 수도 → 변경 감지)
 * 2. 각 대분류의 subcategories 가 0이 아닌지
 * 3. 알려진 앵커 키워드(예: 패션의류잡화 하위에 "여성의류")가 있는지
 * 4. getCoupangTopCategoriesWithPreview() 가 모든 카드에 preview 또는
 *    previewError 를 채워 반환하는지
 *
 * 실패 시 exit 1 → CI/pre-commit 에 연결 가능.
 *
 * 토큰 우선순위: .data/itemscout-token.json > $ITEMSCOUT_TOKEN
 *
 * 참고: 이 스크립트는 정확한 라벨-id 매핑을 강제하지 않는다.
 *       ItemScout 이 조용히 id 를 재할당하는 게 이 버그의 근본 원인인데,
 *       "어떤 라벨이든 non-empty subcategories 가 있어야 한다" 는 약한 조건만
 *       강제해서, UI(카드 preview) 가 사용자에게 진실을 보여주도록 책임을 넘긴다.
 */
import {
  getCoupangTopCategories,
  getCoupangTopCategoriesWithPreview,
  getSubcategories,
} from '../src/lib/itemscout/client';

interface Finding {
  level: 'PASS' | 'WARN' | 'FAIL';
  message: string;
}

const EXPECTED_MIN_TOPS = 10;   // 최소 10개 대분류는 와야 정상
const EXPECTED_MAX_TOPS = 30;   // 이보다 많으면 수상
// 현재(2026-04) ItemScout API 가 내려주는 실제 라벨.
// UI(CATEGORY_ICONS) 와 이 리스트는 smoke 통과 후에만 동일한 값이어야 한다.
const ANCHOR_TOP_NAMES = [
  '패션의류잡화', '뷰티', '출산/유아동', '식품',
  '스포츠/레져', '가전/디지털',
];

const findings: Finding[] = [];

function pass(msg: string): void {
  findings.push({ level: 'PASS', message: msg });
}
function warn(msg: string): void {
  findings.push({ level: 'WARN', message: msg });
}
function fail(msg: string): void {
  findings.push({ level: 'FAIL', message: msg });
}

async function run(): Promise<void> {
  // ── 1. 대분류 개수 체크 ───────────────────────────────────
  const tops = await getCoupangTopCategories();
  if (tops.length === 0) {
    fail(`대분류 0개 반환 — API 완전 고장 가능성`);
    return;
  }
  if (tops.length < EXPECTED_MIN_TOPS) {
    fail(`대분류 ${tops.length}개 반환 — 예상 ≥${EXPECTED_MIN_TOPS}, 스키마 변경 의심`);
  } else if (tops.length > EXPECTED_MAX_TOPS) {
    warn(`대분류 ${tops.length}개 반환 — 예상 ≤${EXPECTED_MAX_TOPS}, 중복 가능성`);
  } else {
    pass(`대분류 ${tops.length}개 반환 (정상 범위)`);
  }

  // ── 2. 앵커 라벨 존재 여부 ──────────────────────────────
  const names = new Set(tops.map((t) => t.n));
  for (const anchor of ANCHOR_TOP_NAMES) {
    if (names.has(anchor)) {
      pass(`앵커 라벨 "${anchor}" 존재`);
    } else {
      warn(`앵커 라벨 "${anchor}" 누락 — UI 아이콘/안내가 어긋날 수 있음`);
    }
  }

  // ── 3. 각 대분류의 subcategories 비어있지 않은지 ──────────
  const subPromises = tops.map(async (c) => {
    try {
      const subs = await getSubcategories(c.id);
      return { cat: c, subs, err: null as null | string };
    } catch (e) {
      return {
        cat: c, subs: [],
        err: e instanceof Error ? e.message : String(e),
      };
    }
  });
  const subResults = await Promise.all(subPromises);

  let emptyCount = 0;
  for (const { cat, subs, err } of subResults) {
    if (err) {
      fail(`id=${cat.id} n="${cat.n}" subcategories 호출 실패: ${err}`);
    } else if (subs.length === 0) {
      emptyCount++;
    }
  }
  if (emptyCount === 0) {
    pass(`모든 대분류(${tops.length}개)가 하위를 반환`);
  } else if (emptyCount > tops.length / 2) {
    fail(`${emptyCount}/${tops.length} 대분류가 빈 하위 — API 대규모 고장 의심`);
  } else {
    warn(`${emptyCount}/${tops.length} 대분류가 빈 하위 — 일부 카테고리 비어있음`);
  }

  // ── 4. preview 포함 버전 검증 ───────────────────────────
  const withPreview = await getCoupangTopCategoriesWithPreview();
  if (withPreview.length !== tops.length) {
    fail(
      `preview 버전 개수(${withPreview.length}) 와 기본(${tops.length}) 불일치`,
    );
  } else {
    pass(`preview 버전 개수 일치 (${withPreview.length}개)`);
  }

  const noPreviewCount = withPreview.filter(
    (c) => c.preview.length === 0 && !c.previewError,
  ).length;
  if (noPreviewCount === 0) {
    pass(`모든 카드가 preview 또는 previewError 를 가짐`);
  } else {
    warn(`${noPreviewCount} 개 카드가 preview 없음 (에러도 없음 — 조용한 실패)`);
  }

  // ── 리포트 ─────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━ 상세 ━━━━━━━━━━━━━━');
  for (const { cat, subs, err } of subResults) {
    const head = `id=${cat.id.toString().padStart(4)} n="${cat.n}"`;
    if (err) {
      console.log(`  ❌ ${head} → ERROR ${err}`);
    } else if (subs.length === 0) {
      console.log(`  ⚠  ${head} → (빈 하위)`);
    } else {
      const sample = subs.slice(0, 3).map((s) => s.name).join(', ');
      console.log(`  ✓  ${head} → ${sample}${subs.length > 3 ? ', …' : ''}`);
    }
  }
}

(async () => {
  console.log('[itemscout-smoke] 시작 — ItemScout 카테고리 매핑 회귀 감지');
  await run();

  // ── 요약 ───────────────────────────────────────────────
  const passes = findings.filter((f) => f.level === 'PASS').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  const fails = findings.filter((f) => f.level === 'FAIL').length;

  console.log('\n━━━━━━━━━━━━━━ 요약 ━━━━━━━━━━━━━━');
  for (const f of findings) {
    const icon = f.level === 'PASS' ? '✓' : f.level === 'WARN' ? '⚠' : '✗';
    console.log(`  ${icon} [${f.level}] ${f.message}`);
  }
  console.log(`\n  PASS=${passes}  WARN=${warns}  FAIL=${fails}`);

  if (fails > 0) {
    console.error('\n[itemscout-smoke] 실패 — ItemScout API 회귀 의심');
    process.exit(1);
  }
  if (warns > 0) {
    console.log('\n[itemscout-smoke] 경고 있음 — 검토 필요하나 차단하지 않음');
  }
  console.log('\n[itemscout-smoke] 통과');
})().catch((e: unknown) => {
  console.error('[itemscout-smoke] 크래시:', e instanceof Error ? e.stack : String(e));
  process.exit(2);
});
