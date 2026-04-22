#!/usr/bin/env node
/**
 * 소싱 워크플로우 통합 테스트 — Step 3~8 데이터 레이어를 실제 DB 로 검증.
 *
 * 각 스텝별로:
 * 1. 더미 상품 생성
 * 2. 기능 실행 (plan, assignee, marketing, rocket guard)
 * 3. DB 에서 실제 저장·제약 확인
 * 4. 정리
 *
 * 사용: npx tsx --env-file=.env.local scripts/probe-workflow-integration.ts
 */
import { eq } from 'drizzle-orm';

import { db, withCompanyContext } from '../src/db';
import {
  products,
  purchaseOrders,
  suppliers,
  users,
} from '../src/db/schema';
import { listCompanyMembers } from '../src/lib/auth/user';
import { listActivitiesForProduct, createActivity, updateActivityStatus } from '../src/lib/marketing/activities';
import { createProduct, updateProduct } from '../src/lib/products/mutations';
import { getPlanByProductId, upsertPlan } from '../src/lib/products/plans';
import { transitionProductStatus } from '../src/lib/products/transitions';

const ADMIN_EMAIL = 'admin@buywise.co';
const TEST_PREFIX = 'PROBE-TEST-';

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────

let stepNum = 0;
const log = {
  step: (msg: string) => {
    stepNum += 1;
    console.log(`\n━━━━━━ Step ${stepNum}: ${msg} ━━━━━━`);
  },
  ok: (msg: string) => console.log(`  ✅ ${msg}`),
  fail: (msg: string) => console.log(`  ❌ ${msg}`),
  info: (msg: string) => console.log(`     ${msg}`),
};

async function cleanup(companyId: string): Promise<void> {
  await withCompanyContext(companyId, async (tx) => {
    // FK 의존 순서 역순으로 삭제
    //   product_state_history, purchase_orders, tasks 는 products 참조 → 먼저 지움
    //   marketing_activities, product_plans 는 CASCADE 로 자동 삭제
    const deleteScript = `
      DELETE FROM purchase_orders
        WHERE company_id = '${companyId}' AND product_id IN (
          SELECT id FROM products WHERE company_id = '${companyId}' AND code LIKE '${TEST_PREFIX}%'
        );
      DELETE FROM product_state_history
        WHERE company_id = '${companyId}' AND product_id IN (
          SELECT id FROM products WHERE company_id = '${companyId}' AND code LIKE '${TEST_PREFIX}%'
        );
      DELETE FROM tasks
        WHERE company_id = '${companyId}' AND product_id IN (
          SELECT id FROM products WHERE company_id = '${companyId}' AND code LIKE '${TEST_PREFIX}%'
        );
      DELETE FROM products
        WHERE company_id = '${companyId}' AND code LIKE '${TEST_PREFIX}%';
      DELETE FROM suppliers
        WHERE company_id = '${companyId}' AND name LIKE '${TEST_PREFIX}%';
    `;
    await tx.execute(
      deleteScript as unknown as Parameters<typeof tx.execute>[0],
    );
    log.info(`cleanup: ${TEST_PREFIX}* 상품·PO·history·suppliers 삭제`);
  });
}

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 컨텍스트 준비
  const adminRows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const admin = adminRows[0];
  if (!admin?.active_company_id) throw new Error('admin 세팅 문제');
  const companyId = admin.active_company_id;
  console.log(`[probe] admin=${admin.id.slice(0, 8)} company=${companyId.slice(0, 8)}`);

  await cleanup(companyId);

  const errors: string[] = [];
  let testProductId: string | null = null;

  // ── Step 3: 1688 링크 필드 저장/조회 ──
  log.step('1688 링크 필드 (cn_source_url)');
  try {
    const now = Date.now();
    const { id } = await createProduct({
      companyId,
      code: `${TEST_PREFIX}URL-${now}`,
      name: '테스트상품_1688링크',
      cnSourceUrl: 'https://detail.1688.com/offer/123456.html',
      createdBy: admin.id,
      ownerUserId: admin.id,
    });
    testProductId = id;
    const row = await withCompanyContext(companyId, async (tx) => {
      const rows = await tx.select().from(products).where(eq(products.id, id)).limit(1);
      return rows[0];
    });
    if (row?.cn_source_url === 'https://detail.1688.com/offer/123456.html') {
      log.ok('cn_source_url 저장 & 조회 정상');
    } else {
      errors.push('cn_source_url 저장 실패');
      log.fail(`cn_source_url 불일치: ${row?.cn_source_url}`);
    }
  } catch (e) {
    errors.push(`Step 3 예외: ${(e as Error).message}`);
    log.fail(`${(e as Error).message}`);
  }

  // ── Step 4: 기획서 저장/AI 프롬프트 ──
  log.step('기획서 (product_plans) upsert + AI 프롬프트');
  if (testProductId) {
    try {
      const { buildDetailPagePrompt } = await import('../src/lib/research/detail-page-prompt');
      const prompt = buildDetailPagePrompt({
        productName: '테스트상품_1688링크',
        category: '식품',
        cnSourceUrl: 'https://detail.1688.com/offer/123456.html',
        competitorTitles: ['경쟁사A', '경쟁사B', '경쟁사C'],
        complaints: ['너무 크다', '냄새난다'],
      });
      if (prompt.includes('테스트상품_1688링크') && prompt.includes('경쟁사A') && prompt.includes('너무 크다')) {
        log.ok('AI 프롬프트 빌더 — 상품명·경쟁사·불만포인트 전부 포함');
      } else {
        errors.push('AI 프롬프트 조립 실패');
        log.fail('프롬프트 내용 불일치');
      }

      await upsertPlan({
        companyId,
        productId: testProductId,
        userId: admin.id,
        sections: [
          { position: 0, title: '메인 후킹', imageDesc: '주방 위 클로즈업', color: '베이지', copy: '신선한 한 입', hook: '손 안 아픔' },
        ],
        hookSummary: '다른 상품보다 손에 부담 적음',
        targetAudience: '30~40대 주부',
        notes: '광고 심의 주의',
        resultConfidence: 'edited',
      });
      const plan1 = await getPlanByProductId(companyId, testProductId);
      if (plan1 && plan1.hook_summary === '다른 상품보다 손에 부담 적음') {
        log.ok('upsert (INSERT 경로) 정상');
      } else {
        errors.push('plan INSERT 실패');
        log.fail('plan 조회 실패');
      }

      // 두 번째 upsert (UPDATE 경로)
      await upsertPlan({
        companyId,
        productId: testProductId,
        userId: admin.id,
        hookSummary: '업데이트된 후킹',
        resultConfidence: 'confirmed',
      });
      const plan2 = await getPlanByProductId(companyId, testProductId);
      if (plan2?.hook_summary === '업데이트된 후킹' && plan2?.result_confidence === 'confirmed') {
        log.ok('upsert (UPDATE 경로) 정상 + confidence 전환');
      } else {
        errors.push('plan UPDATE 실패');
        log.fail(`plan 업데이트 불일치: ${plan2?.hook_summary} / ${plan2?.result_confidence}`);
      }
    } catch (e) {
      errors.push(`Step 4 예외: ${(e as Error).message}`);
      log.fail(`${(e as Error).message}`);
    }
  }

  // ── Step 5: 담당자 3배정 ──
  log.step('담당자 3배정 (plan/listing/rocket assignee)');
  if (testProductId) {
    try {
      const members = await listCompanyMembers(companyId);
      if (members.length === 0) {
        errors.push('멤버 없음');
        log.fail('회사 멤버 0명');
      } else {
        const assignee = members[0]!;
        log.info(`배정 대상: ${assignee.name} (${assignee.email})`);

        await updateProduct({
          companyId,
          productId: testProductId,
          planAssigneeId: assignee.id,
          listingAssigneeId: assignee.id,
          rocketAssigneeId: assignee.id,
        });

        const row = await withCompanyContext(companyId, async (tx) => {
          const rows = await tx.select().from(products).where(eq(products.id, testProductId!)).limit(1);
          return rows[0];
        });

        if (
          row?.plan_assignee_id === assignee.id
          && row?.listing_assignee_id === assignee.id
          && row?.rocket_assignee_id === assignee.id
        ) {
          log.ok('plan/listing/rocket 3필드 모두 저장됨');
        } else {
          errors.push('담당자 저장 실패');
          log.fail(`plan=${row?.plan_assignee_id} listing=${row?.listing_assignee_id} rocket=${row?.rocket_assignee_id}`);
        }
      }
    } catch (e) {
      errors.push(`Step 5 예외: ${(e as Error).message}`);
      log.fail(`${(e as Error).message}`);
    }
  }

  // ── Step 7: 마케팅 활동 CRUD ──
  log.step('마케팅 활동 (marketing_activities) 7채널');
  if (testProductId) {
    try {
      const activity = await createActivity({
        companyId,
        productId: testProductId,
        userId: admin.id,
        channel: 'coupang_review',
        costKrw: 50000,
        notes: '체험단 플랫폼 xyz',
      });
      log.ok(`createActivity → id=${activity.id.slice(0, 8)}`);

      // 상태 전환
      await updateActivityStatus(companyId, activity.id, 'in_progress');
      log.info('pending → in_progress');
      await updateActivityStatus(companyId, activity.id, 'done');
      log.info('in_progress → done');

      // 추가 채널 2개 생성
      await createActivity({
        companyId,
        productId: testProductId,
        userId: admin.id,
        channel: 'blog',
        costKrw: 100000,
      });
      await createActivity({
        companyId,
        productId: testProductId,
        userId: admin.id,
        channel: 'coupang_cpc',
        costKrw: 200000,
      });

      const list = await listActivitiesForProduct(companyId, testProductId);
      const doneOne = list.find((l) => l.channel === 'coupang_review');
      if (list.length === 3 && doneOne?.status === 'done' && doneOne.completed_at !== null) {
        log.ok(`총 3개 활동 조회 + 전환 타임스탬프 정상 기록됨`);
      } else {
        errors.push('마케팅 활동 조회 실패');
        log.fail(`list=${list.length} doneOne.status=${doneOne?.status}`);
      }
    } catch (e) {
      errors.push(`Step 7 예외: ${(e as Error).message}`);
      log.fail(`${(e as Error).message}`);
    }
  }

  // ── Step 8: 로켓 가드 (listing → active with/without received_at) ──
  log.step('로켓 입점 가드 (listing → active 는 입고 확인 필수)');
  if (testProductId) {
    try {
      // 파이프라인: research → sourcing → importing → listing → active
      await transitionProductStatus({ companyId, productId: testProductId, toStatus: 'sourcing', changedBy: admin.id });
      log.info('research → sourcing');

      // importing 으로 가려면 supplier+quote 필요 — 그건 스킵 가능하니까 직접 status UPDATE
      await withCompanyContext(companyId, async (tx) => {
        await tx.update(products).set({ status: 'importing' }).where(eq(products.id, testProductId!));
      });
      log.info('(shortcut) status = importing');

      await transitionProductStatus({ companyId, productId: testProductId, toStatus: 'listing', changedBy: admin.id });
      log.info('importing → listing');

      // ① received_at 없이 active 시도 → 실패해야 함
      let blockedAsExpected = false;
      try {
        await transitionProductStatus({ companyId, productId: testProductId, toStatus: 'active', changedBy: admin.id });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('입고') || msg.includes('received_at')) {
          blockedAsExpected = true;
        } else {
          throw err;
        }
      }
      if (blockedAsExpected) {
        log.ok('received_at 없이 active 전환 시도 → 정상 차단됨');
      } else {
        errors.push('로켓 가드 작동 안함!');
        log.fail('received_at 없는데도 전환이 성공해버림');
      }

      // ② 더미 purchase_order with received_at 생성 후 재시도 → 성공해야 함
      //    먼저 supplier 하나 만들어야 함 (FK 제약)
      const supInserted = await withCompanyContext(companyId, async (tx) => {
        return tx
          .insert(suppliers)
          .values({
            company_id: companyId,
            name: `${TEST_PREFIX}SUP-${Date.now()}`,
            source: '1688',
          })
          .returning({ id: suppliers.id });
      });
      const supplierId = supInserted[0]!.id;

      await withCompanyContext(companyId, async (tx) => {
        await tx.insert(purchaseOrders).values({
          company_id: companyId,
          product_id: testProductId!,
          supplier_id: supplierId,
          status: 'received',
          qty: 100,
          unit_price_cny: '10.00',
          total_cny: '1000.00',
          received_at: new Date(),
        });
      });
      log.info('purchase_order(received) 생성됨');

      await transitionProductStatus({ companyId, productId: testProductId, toStatus: 'active', changedBy: admin.id });
      const afterTransit = await withCompanyContext(companyId, async (tx) => {
        const rows = await tx.select({ status: products.status }).from(products).where(eq(products.id, testProductId!)).limit(1);
        return rows[0];
      });
      if (afterTransit?.status === 'active') {
        log.ok('received_at 있으면 active 전환 성공');
      } else {
        errors.push('received_at 있는데도 전환 실패');
        log.fail(`전환 후 status=${afterTransit?.status}`);
      }
    } catch (e) {
      errors.push(`Step 8 예외: ${(e as Error).message}`);
      log.fail(`${(e as Error).message}`);
    }
  }

  // ── 정리 ──
  log.step('정리');
  await cleanup(companyId);
  log.ok('테스트 데이터 삭제 완료');

  // ── 요약 ──
  console.log('\n━━━━━━━━━━━━━━ 요약 ━━━━━━━━━━━━━━');
  if (errors.length === 0) {
    console.log('  🎉 전체 통과 (Step 3·4·5·7·8 데이터 레이어 정상)');
    process.exit(0);
  } else {
    console.log(`  ❌ 실패 ${errors.length}건:`);
    for (const e of errors) console.log(`    - ${e}`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error('[probe] 크래시:', e instanceof Error ? e.stack : String(e));
  process.exit(2);
});
