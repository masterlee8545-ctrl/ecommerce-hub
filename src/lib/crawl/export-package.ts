/**
 * 자동 복구가 실패했을 때 사람이 Claude 에 첨부할 스냅샷 패키지를 만든다.
 *
 * 출처: market-research-toolkit `registry/export_package.py` 이식.
 * ADR: docs/ADR-014.md
 * 헌법: CLAUDE.md §1 P-7 (시크릿 노출 금지) — 아래 경고 참조
 *
 * ⚠ `page.html` 은 **로그인된 상태의 화면**이다. 계정명·주문내역·토큰이
 *   그대로 들어 있을 수 있다. 외부(claude.ai 등)에 올리기 전에 반드시 훑어본다.
 *   그래서 이 폴더는 `.gitignore` 대상이고, 커밋되면 안 된다.
 *
 * 받은 답을 그대로 믿지 않는다: `heal.ts` 가 **저장된 스냅샷으로 재검증**한 뒤
 * 계약을 통과한 후보만 채택한다. 틀린 셀렉터를 받아도 레지스트리는 오염되지 않는다.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SelectorEntry } from './types';

const SNAPSHOT_ROOT = path.join(process.cwd(), 'data', 'crawl-snapshots');
/** 셀렉터 하나당 남겨 둘 스냅샷 개수. 넘으면 오래된 것부터 지운다 */
const KEEP_PER_SELECTOR = 3;

/** 스냅샷 루트 경로 — 안내 메시지에 쓴다. */
export const snapshotRoot = SNAPSHOT_ROOT;

/**
 * 첨부 크기를 줄이려고 화면에 안 보이는 덩어리를 걷어낸다.
 *
 * 정규식으로 처리한다 — 이 결과물은 **사람과 Claude 가 읽을 자료**이지
 * 다시 파싱할 문서가 아니라서, 파서를 새로 들일 이유가 없다.
 * (계약 재검증은 원본이 아니라 이 파일을 브라우저에 다시 실어서 한다)
 */
export function shrinkHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
}

/** 파일명에 쓸 수 없는 글자를 바꾼다. */
function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildPrompt(selectorId: string, entry: SelectorEntry, failReason: string): string {
  const contract = JSON.stringify(entry.contract, null, 2);
  return `# 셀렉터 복구 요청 — \`${selectorId}\`

첨부한 \`page.html\` 은 수집이 깨진 시점의 실제 화면이다.

## 이 셀렉터가 가리켜야 하는 것

${entry.description}

## 지금 쓰던 셀렉터 (더는 안 맞음)

\`\`\`
${entry.primary}
\`\`\`

실패 사유: ${failReason}

## 통과해야 하는 계약

\`\`\`json
${contract}
\`\`\`

계약의 의미:
- \`minMatches\` — 이 개수 이상이 잡혀야 한다
- \`attr\` — 그 속성이 **있는** 노드만 인정한다 (없으면 탈락)
- \`mustMatch\` — 검사 대상 값(속성값, 없으면 노드 텍스트)이 이 정규식에 맞아야 한다
- \`minTextLen\` — 노드 텍스트가 이 길이 이상이어야 한다
${entry.within ? `\n범위: 이 셀렉터는 \`${entry.within}\` 이 잡은 컨테이너 **안쪽** 기준이다. 컨테이너 상대 셀렉터로 답하라.\n` : ''}
## 요청

\`page.html\` 을 보고 위 계약을 만족하는 CSS 셀렉터 후보를 **최대 5개**, 좋은 순서로 제안하라.

지켜야 할 것:
- 배포마다 바뀌는 난수 클래스(\`sc-xxxx\`, \`css-1a2b3c\`, \`jsx-123\`)를 쓰지 마라
- \`data-testid\`, \`role\`, \`itemprop\`, 의미 있는 속성 선택자를 우선하라
- 태그 하나짜리(\`div\`, \`li\`)는 정밀도가 없으니 최후수단으로만
- 아래 JSON 형식으로만 답하라. 설명 문장이나 코드 펜스를 붙이지 마라

\`\`\`json
{ "candidates": ["...", "..."] }
\`\`\`

## 답을 받은 뒤

받은 JSON 을 그대로 붙여 넣으면 프로그램이 **이 스냅샷으로 다시 검증**한 뒤
계약을 통과한 후보만 채택한다. 틀린 답을 줘도 레지스트리는 오염되지 않는다.
`;
}

/**
 * 스냅샷 폴더를 만들고 `page.html` + `PROMPT.md` 를 쓴다.
 *
 * @returns 만들어진 폴더 경로. 쓰기에 실패하면 null (치유 실패 보고를 막지 않기 위해)
 */
export async function exportPackage(
  selectorId: string,
  entry: SelectorEntry,
  html: string,
  failReason: string,
  stamp?: string,
): Promise<string | null> {
  const at = stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(SNAPSHOT_ROOT, `${safeName(selectorId)}_${safeName(at)}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'page.html'), shrinkHtml(html), 'utf-8');
    await writeFile(
      path.join(dir, 'PROMPT.md'),
      buildPrompt(selectorId, entry, failReason),
      'utf-8',
    );
    return dir;
  } catch (err) {
    console.error(
      `[crawl/export-package] 스냅샷 저장 실패 (${dir}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** 셀렉터 하나당 최근 N 개만 남기고 지운다. */
export async function pruneSnapshots(selectorId: string): Promise<void> {
  const prefix = `${safeName(selectorId)}_`;
  let entries: string[];
  try {
    entries = await readdir(SNAPSHOT_ROOT);
  } catch {
    return; // 아직 스냅샷을 만든 적이 없다
  }
  const mine = entries.filter((name) => name.startsWith(prefix)).sort();
  const stale = mine.slice(0, Math.max(0, mine.length - KEEP_PER_SELECTOR));
  for (const name of stale) {
    try {
      await rm(path.join(SNAPSHOT_ROOT, name), { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[crawl/export-package] 오래된 스냅샷 삭제 실패 (${name}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
