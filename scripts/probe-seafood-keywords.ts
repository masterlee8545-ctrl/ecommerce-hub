import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartFetches } from '../src/db/schema';

(async () => {
  const fetched = await db
    .select({ keyword: keywordChartFetches.keyword })
    .from(keywordChartFetches)
    .where(eq(keywordChartFetches.last_status, 'ok'));
  const keywords = fetched.map((r) => r.keyword);

  console.log(`전체 키워드: ${keywords.length}\n`);

  const patterns = [
    { name: '수산물', re: /고등어|갈치|삼치|굴비|명란|멸치|새우|오징어|문어|낙지|꼬막|미역|다시마|김(?!치|밥|장|기|밥)|어묵|진미채|마른오징어|마른새우/ },
    { name: '자반/가공수산', re: /자반|꿀밤|진미채|어포|북어|황태/ },
    { name: '김치/장아찌', re: /김치|깍두기|총각|갓김치|백김치|묵은지|장아찌|젓갈|매실장아찌/ },
    { name: '한과/떡', re: /한과|약과|강정|유과|가래떡|인절미|찹쌀떡|누룽지|약밥/ },
    { name: '묵/두부', re: /도토리묵|메밀묵|청포묵|^묵$|두부(?!\s*전)/ },
    { name: '꿀/잼/청', re: /^꿀$|^허니|벌꿀|잼(?!액)|시럽|시즈닝/ },
  ];

  for (const p of patterns) {
    const matched = keywords.filter((k) => p.re.test(k));
    console.log(`\n${p.name}: ${matched.length}개`);
    matched.forEach((k) => console.log(`  - ${k}`));
  }

  process.exit(0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
