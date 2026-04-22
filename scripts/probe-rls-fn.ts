import { sql } from 'drizzle-orm';
import { db } from '../src/db';

(async () => {
  const fn = await db.execute(sql`
    SELECT proname FROM pg_proc
    WHERE proname = 'current_company_id' AND pronamespace = 'public'::regnamespace
  `);
  console.log('current_company_id 함수 존재?', (fn as unknown as unknown[]).length > 0);

  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('\n전체 public 테이블:');
  for (const row of tables as unknown as Array<{ table_name: string }>) {
    console.log(`  - ${row.table_name}`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
