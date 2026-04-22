import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { mcpTokens } from '../src/db/schema';

(async () => {
  const res = await db
    .update(mcpTokens)
    .set({ revoked_at: new Date() })
    .where(eq(mcpTokens.label, 'curl smoke test'))
    .returning({ id: mcpTokens.id });
  console.log('revoked rows:', res.length);
  process.exit(0);
})();
