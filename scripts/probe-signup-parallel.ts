#!/usr/bin/env node
/**
 * 병렬 회원가입 프로브 — Phase D 검증
 *
 * 3명을 동시에 가입시키고 각 계정이 독립된 법인에 owner 로 들어갔는지,
 * 크로스 오염 없는지, authenticate 로 로그인 가능한지 검증.
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/probe-signup-parallel.ts
 */
import { inArray, or } from 'drizzle-orm';

import { db } from '../src/db';
import { companies, userCompanies, users } from '../src/db/schema';
import { authenticateUser } from '../src/lib/auth/user';
import { signUpUser } from '../src/lib/auth/signup';

interface ProbeInput {
  email: string;
  password: string;
  name: string;
  companyName: string;
  businessType: 'industrial' | 'agricultural' | 'other';
}

const INPUTS: ProbeInput[] = [
  {
    email: 'probe1@signup.test',
    password: 'TestPass123!',
    name: '프로브1 홍길동',
    companyName: '프로브1 상사 (주)',
    businessType: 'industrial',
  },
  {
    email: 'probe2@signup.test',
    password: 'TestPass456!',
    name: '프로브2 김영희',
    companyName: '프로브2 농장',
    businessType: 'agricultural',
  },
  {
    email: 'probe3@signup.test',
    password: 'TestPass789!',
    name: '프로브3 이철수',
    companyName: '프로브3 스튜디오',
    businessType: 'other',
  },
];

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  회원가입 병렬 프로브 시작');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const checks: Check[] = [];

  // 0) 기존 프로브 데이터 있으면 먼저 정리 (idempotent)
  const priorUsers = await db
    .select({ id: users.id, active: users.active_company_id })
    .from(users)
    .where(inArray(users.email, INPUTS.map((i) => i.email)));
  if (priorUsers.length > 0) {
    const priorIds = priorUsers.map((u) => u.id);
    const priorCompanyIds = priorUsers.map((u) => u.active).filter((x): x is string => !!x);
    await db.delete(userCompanies).where(inArray(userCompanies.user_id, priorIds));
    await db.delete(users).where(inArray(users.id, priorIds));
    if (priorCompanyIds.length > 0) {
      await db.delete(companies).where(inArray(companies.id, priorCompanyIds));
    }
    console.log(`[사전정리] 기존 프로브 계정 ${priorUsers.length}개 삭제`);
  }

  // 1) 병렬 가입
  const t0 = Date.now();
  const results = await Promise.all(
    INPUTS.map(async (input, idx) => {
      try {
        const r = await signUpUser(input);
        console.log(`  [${idx + 1}] ✅ ${input.email} → userId=${r.userId.slice(0, 8)}… companyId=${r.companyId.slice(0, 8)}…`);
        return { idx, ok: true as const, result: r, input };
      } catch (err) {
        console.log(`  [${idx + 1}] ❌ ${input.email} → ${err instanceof Error ? err.message : String(err)}`);
        return { idx, ok: false as const, err, input };
      }
    }),
  );
  console.log(`[병렬] 총 ${results.length}건 / ${Date.now() - t0}ms`);

  const ok = results.filter((r): r is { idx: number; ok: true; result: Awaited<ReturnType<typeof signUpUser>>; input: ProbeInput } => r.ok);
  checks.push({
    name: '3명 전원 가입 성공',
    ok: ok.length === INPUTS.length,
    detail: `${ok.length}/${INPUTS.length} 성공`,
  });

  if (ok.length !== INPUTS.length) {
    console.log('\n❌ 가입 실패 발생 — 이후 검증 스킵');
    printSummary(checks);
    process.exit(1);
  }

  // 2) 고유성 — 모든 userId / companyId 가 서로 다름
  const userIds = ok.map((r) => r.result.userId);
  const companyIds = ok.map((r) => r.result.companyId);
  checks.push({
    name: '각 userId / companyId 고유',
    ok:
      new Set(userIds).size === userIds.length &&
      new Set(companyIds).size === companyIds.length,
  });

  // 3) DB 조회 — companies 테이블에 3건, 각자 다른 business_type
  const companyRows = await db.select().from(companies).where(inArray(companies.id, companyIds));
  const typeSet = new Set(companyRows.map((c) => c.business_type));
  checks.push({
    name: `companies 3건 저장 + business_type (${[...typeSet].join(', ')})`,
    ok: companyRows.length === 3 && typeSet.size === 3,
    detail: `rows=${companyRows.length}`,
  });

  // 4) DB 조회 — users 3건, password_hash 가 평문과 다름 (bcrypt 해시 확인)
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const allHashed = userRows.every(
    (u) => u.password_hash.startsWith('$2') && u.password_hash.length > 50,
  );
  const activeLinksCorrect = ok.every((r) => {
    const u = userRows.find((x) => x.id === r.result.userId);
    return u?.active_company_id === r.result.companyId;
  });
  checks.push({
    name: 'users 3건 저장 + bcrypt 해시 + active_company_id 자기 법인',
    ok: userRows.length === 3 && allHashed && activeLinksCorrect,
    detail: `rows=${userRows.length}, hashed=${allHashed}, active=${activeLinksCorrect}`,
  });

  // 5) 멤버십 — user_companies 3건, 각자 owner, 크로스 오염 없음
  const memberships = await db
    .select()
    .from(userCompanies)
    .where(
      or(
        inArray(userCompanies.user_id, userIds),
        inArray(userCompanies.company_id, companyIds),
      )!,
    );
  // 각 userId → companyId 1건씩, 역할 owner, 본인 법인
  const crossCheck = ok.every((r) => {
    const mine = memberships.filter((m) => m.user_id === r.result.userId);
    return (
      mine.length === 1 &&
      mine[0]?.company_id === r.result.companyId &&
      mine[0]?.role === 'owner'
    );
  });
  const foreignMembership = memberships.some((m) => {
    const userIdx = ok.findIndex((r) => r.result.userId === m.user_id);
    const companyIdx = ok.findIndex((r) => r.result.companyId === m.company_id);
    return userIdx !== -1 && companyIdx !== -1 && userIdx !== companyIdx;
  });
  checks.push({
    name: 'user_companies 각자 owner + 크로스 오염 없음',
    ok: memberships.length === 3 && crossCheck && !foreignMembership,
    detail: `rows=${memberships.length}, crossOK=${crossCheck}, foreignFound=${foreignMembership}`,
  });

  // 6) authenticate — 각자 자기 비번으로 로그인 가능
  const authResults = await Promise.all(
    ok.map(async (r) => {
      const auth = await authenticateUser(r.input.email, r.input.password);
      return {
        email: r.input.email,
        ok: auth !== null && auth.id === r.result.userId && auth.activeCompanyId === r.result.companyId,
      };
    }),
  );
  checks.push({
    name: '각자 이메일+비번으로 authenticate 성공',
    ok: authResults.every((a) => a.ok),
    detail: authResults.map((a) => `${a.email}=${a.ok ? '✅' : '❌'}`).join(' '),
  });

  // 7) 크로스 비번 거부 — probe1 이메일 + probe2 비번 로그인 실패해야
  const crossFail = await authenticateUser(INPUTS[0]!.email, INPUTS[1]!.password);
  checks.push({
    name: '타인 비밀번호로 로그인 거부',
    ok: crossFail === null,
  });

  // 8) 중복 가입 시도 — 같은 이메일 재가입 시 에러
  let dupRejected = false;
  try {
    await signUpUser(INPUTS[0]!);
  } catch (err) {
    dupRejected =
      err instanceof Error &&
      (err.message.includes('이미 가입') || err.message.includes('email_taken'));
  }
  checks.push({
    name: '중복 이메일 재가입 거부',
    ok: dupRejected,
  });

  // 결과 출력
  printSummary(checks);

  // 정리 — 모든 프로브 데이터 삭제
  await db.delete(userCompanies).where(inArray(userCompanies.user_id, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(companies).where(inArray(companies.id, companyIds));
  console.log('\n[정리] 프로브 계정 3개 + 법인 3개 삭제 완료');

  const failed = checks.filter((c) => !c.ok).length;
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[probe-signup-parallel] 실패:', err);
  process.exit(1);
});

function printSummary(checks: Check[]): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  검증 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const c of checks) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(
    failed === 0
      ? `🎉 전원 통과 (${checks.length}/${checks.length})`
      : `⚠ 실패 ${failed}건 / 통과 ${checks.length - failed}건`,
  );
}
