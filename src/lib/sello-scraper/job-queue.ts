/**
 * scrape_jobs 큐 헬퍼 — enqueue / claim / complete / status.
 *
 * 헌법: CLAUDE.md §1 P-2 (실패 명시), §1 P-4 (멀티테넌트)
 *
 * 역할:
 * - 웹(Vercel API) 은 enqueue·listForBatch 만 호출 (스크래퍼 실행 없음)
 * - 로컬 워커는 claimNextPending·markRunning·completeJob·failJob 호출
 * - 멀티 워커 대비: atomic claim 을 위해 FOR UPDATE SKIP LOCKED 사용
 *
 * RLS 주의:
 * - 웹 API 는 requireCompanyContext + withCompanyContext(companyId) 경유
 * - 워커는 DB 직접 접근 (service-role 수준) — 모든 company 의 job 을 처리
 *   (현재 이 DB 는 0001 RLS 미적용 상태라 일반 쿼리로 충분)
 */
import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, withCompanyContext } from '@/db';
import {
  scrapeJobs,
  type ScrapeJob,
  type ScrapeJobStatus,
} from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 큐 등록 (웹 API → 배치 시작)
// ─────────────────────────────────────────────────────────

export interface EnqueueBatchInput {
  companyId: string;
  keywords: string[];
  /** 필터 조건 — 모든 job 에 복사 저장 */
  filterCond: unknown;
  forceFresh: boolean;
  requestedBy: string;
}

/**
 * N개 키워드를 하나의 배치로 큐에 삽입.
 * 같은 batch_id 내 중복 키워드는 unique 제약으로 자동 스킵.
 *
 * @returns 새로 생성된 batchId
 */
export async function enqueueBatch(
  input: EnqueueBatchInput,
): Promise<{ batchId: string; enqueued: number }> {
  if (!input.companyId) throw new Error('[enqueueBatch] companyId 필수');
  if (input.keywords.length === 0) {
    throw new Error('[enqueueBatch] keywords 가 비어있습니다.');
  }

  // 중복 제거 + trim
  const uniqueKeywords = Array.from(
    new Set(input.keywords.map((k) => k.trim()).filter((k) => k.length > 0)),
  );
  if (uniqueKeywords.length === 0) {
    throw new Error('[enqueueBatch] 유효한 키워드가 없습니다.');
  }

  const batchId = randomUUID();

  await withCompanyContext(input.companyId, async (tx) => {
    await tx.insert(scrapeJobs).values(
      uniqueKeywords.map((kw) => ({
        company_id: input.companyId,
        batch_id: batchId,
        keyword: kw,
        status: 'pending' as ScrapeJobStatus,
        force_fresh: input.forceFresh,
        filter_cond: input.filterCond as Record<string, unknown>,
        requested_by: input.requestedBy,
      })),
    );
  });

  return { batchId, enqueued: uniqueKeywords.length };
}

// ─────────────────────────────────────────────────────────
// 배치 상태 조회 (웹 API → 폴링)
// ─────────────────────────────────────────────────────────

export async function listJobsForBatch(
  companyId: string,
  batchId: string,
): Promise<ScrapeJob[]> {
  if (!companyId || !batchId) return [];
  return withCompanyContext(companyId, async (tx) => {
    return tx
      .select()
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.batch_id, batchId),
          eq(scrapeJobs.company_id, companyId),
        ),
      )
      .orderBy(asc(scrapeJobs.requested_at));
  });
}

/** 회사별 최근 배치 목록 (대시보드용) — distinct batch_id + 집계 */
export async function listRecentBatches(
  companyId: string,
  limit = 10,
): Promise<
  Array<{
    batchId: string;
    total: number;
    done: number;
    pending: number;
    running: number;
    failed: number;
    firstRequestedAt: Date;
  }>
> {
  if (!companyId) return [];
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(scrapeJobs)
      .where(eq(scrapeJobs.company_id, companyId))
      .orderBy(desc(scrapeJobs.requested_at))
      .limit(limit * 50); // batch 당 최대 50 keywords 가정

    // 그룹화
    const byBatch = new Map<
      string,
      { batchId: string; total: number; done: number; pending: number; running: number; failed: number; firstRequestedAt: Date }
    >();
    for (const r of rows) {
      const existing = byBatch.get(r.batch_id);
      const group = existing ?? {
        batchId: r.batch_id,
        total: 0,
        done: 0,
        pending: 0,
        running: 0,
        failed: 0,
        firstRequestedAt: r.requested_at,
      };
      group.total += 1;
      if (r.status === 'done') group.done += 1;
      else if (r.status === 'pending') group.pending += 1;
      else if (r.status === 'running') group.running += 1;
      else if (r.status === 'failed') group.failed += 1;
      if (r.requested_at < group.firstRequestedAt) {
        group.firstRequestedAt = r.requested_at;
      }
      byBatch.set(r.batch_id, group);
    }
    return Array.from(byBatch.values())
      .sort((a, b) => b.firstRequestedAt.getTime() - a.firstRequestedAt.getTime())
      .slice(0, limit);
  });
}

// ─────────────────────────────────────────────────────────
// 워커 전용 — atomic claim + 상태 갱신
// ─────────────────────────────────────────────────────────

/** stale running job 재전환 기준 (5분) — 워커 크래시 복구용 */
const STALE_RUNNING_MS = 5 * 60 * 1000;

/**
 * pending 중 가장 오래된 job 하나를 atomic 하게 claim (running 으로 전환).
 * FOR UPDATE SKIP LOCKED 로 다른 워커와의 동시 픽 방지.
 *
 * 추가: 5분 이상 running 상태로 heartbeat 안 된 job 도 stale 로 간주하고 회수.
 *
 * @returns claim 된 job (없으면 null)
 */
export async function claimNextPendingJob(
  workerId: string,
): Promise<ScrapeJob | null> {
  // 1. stale running 복구 (heartbeat 5분 이상 안된 건 pending 으로 되돌림)
  //    raw SQL 이지만 interval 은 식별자 sql.raw 로 inline — Date 파라미터 없음.
  await db.execute(sql`
    UPDATE scrape_jobs
    SET status = 'pending', started_at = NULL, last_heartbeat_at = NULL, worker_id = NULL
    WHERE status = 'running'
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at < now() - (${sql.raw(String(STALE_RUNNING_MS / 1000))} || ' seconds')::interval
  `);

  // 2. atomic claim — transaction 으로 SELECT FOR UPDATE SKIP LOCKED + UPDATE
  //    Drizzle ORM 경로 사용 → Date 직렬화 문제 없음.
  return db.transaction(async (tx) => {
    // SKIP LOCKED 는 raw SQL 필수 (Drizzle 미지원)
    const candidates = await tx.execute<{ id: string }>(sql`
      SELECT id FROM scrape_jobs
      WHERE status = 'pending'
      ORDER BY requested_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const rows = (candidates as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (candidates as unknown as Array<{ id: string }>);
    const nextId = rows[0]?.id;
    if (!nextId) return null;

    const now = new Date();
    const updated = await tx
      .update(scrapeJobs)
      .set({
        status: 'running',
        started_at: now,
        last_heartbeat_at: now,
        worker_id: workerId,
      })
      .where(eq(scrapeJobs.id, nextId))
      .returning();
    return updated[0] ?? null;
  });
}

/** 워커가 처리 중 heartbeat 갱신 (stuck 감지 방지) */
export async function heartbeat(jobId: string): Promise<void> {
  await db
    .update(scrapeJobs)
    .set({ last_heartbeat_at: new Date() })
    .where(eq(scrapeJobs.id, jobId));
}

/** 성공 — 결과 저장 + done 전환 */
export async function completeJob(
  jobId: string,
  result: unknown,
  opts: { cacheHit: boolean },
): Promise<void> {
  await db
    .update(scrapeJobs)
    .set({
      status: 'done',
      result: result as Record<string, unknown>,
      cache_hit: opts.cacheHit,
      completed_at: new Date(),
      last_heartbeat_at: null,
    })
    .where(eq(scrapeJobs.id, jobId));
}

/** 실패 — error 기록 + failed 전환 */
export async function failJob(jobId: string, error: string): Promise<void> {
  await db
    .update(scrapeJobs)
    .set({
      status: 'failed',
      error,
      completed_at: new Date(),
      last_heartbeat_at: null,
    })
    .where(eq(scrapeJobs.id, jobId));
}

/** 배치 전체 취소 (pending 만 cancelled 로 전환, running 은 건드리지 않음) */
export async function cancelBatch(
  companyId: string,
  batchId: string,
): Promise<number> {
  if (!companyId || !batchId) return 0;
  return withCompanyContext(companyId, async (tx) => {
    const result = await tx
      .update(scrapeJobs)
      .set({ status: 'cancelled', completed_at: new Date() })
      .where(
        and(
          eq(scrapeJobs.batch_id, batchId),
          eq(scrapeJobs.company_id, companyId),
          eq(scrapeJobs.status, 'pending'),
        ),
      )
      .returning({ id: scrapeJobs.id });
    return result.length;
  });
}

/** 이미 완료된 job 들 id 목록 (UI 에서 폴링 시 변경분만 가져올 때 활용 가능) */
export async function listJobIdsByStatus(
  companyId: string,
  batchId: string,
  statuses: ScrapeJobStatus[],
): Promise<string[]> {
  return withCompanyContext(companyId, async (tx) => {
    const rows = await tx
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.batch_id, batchId),
          eq(scrapeJobs.company_id, companyId),
          inArray(scrapeJobs.status, statuses),
        ),
      );
    return rows.map((r) => r.id);
  });
}
