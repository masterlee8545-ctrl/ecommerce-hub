#!/usr/bin/env node
/**
 * drizzle/migrations/ 에 있는 수기 작성 SQL 파일을 실행.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0004_sourcing_workflow
 *
 * 이유:
 *   drizzle-kit migrate 는 journal 에 등록된 마이그레이션만 적용한다.
 *   손으로 만든 SQL 파일(0001 RLS 등)은 journal 에 없으므로 별도 실행이 필요.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { db } from '../src/db';

const name = process.argv[2];
if (!name) {
  console.error('사용법: apply-sql-migration.ts <migration-file-name-without-ext>');
  process.exit(1);
}

(async () => {
  const file = path.join(process.cwd(), 'drizzle', 'migrations', `${name}.sql`);
  console.log(`[apply] 읽는 중: ${file}`);
  const content = await readFile(file, 'utf-8');

  // 단순 split 은 위험 (문자열 안의 세미콜론도 자르므로)
  // 그런데 0004 는 간단한 DDL 라 raw 한 번에 실행해도 됨.
  // drizzle.execute 는 parameterized 쿼리지만 sql.raw 로 raw string 전달.
  console.log(`[apply] SQL 크기: ${content.length} chars`);
  await db.execute(sql.raw(content));
  console.log('[apply] 완료 ✅');

  process.exit(0);
})().catch((err: unknown) => {
  console.error('[apply] 실패:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
