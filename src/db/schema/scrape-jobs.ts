/**
 * scrape_jobs — 셀록홈즈 스크래핑 작업 큐 (Supabase + 로컬 워커 하이브리드)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-2 (실패 명시),
 *       §1 P-4 (멀티테넌트 격리)
 *
 * 역할:
 * - 사용자가 배치 분석 시작 → N개 키워드가 pending 상태로 삽입됨
 * - 로컬 Windows PC 의 워커 프로세스(`npm run sello:worker`)가 5초마다
 *   pending 레코드 중 하나를 atomic claim 후 Playwright 스크래핑 실행
 * - 결과는 `result` jsonb 에 FirstPageMetrics 원본 저장
 * - 웹 UI(Vercel) 는 `/api/batch-jobs/<batchId>` 폴링으로 상태 확인
 *
 * 배포 시나리오:
 *   [Vercel] 웹·API              →  enqueue(scrape_jobs INSERT)
 *        ↕
 *   [Supabase Postgres] scrape_jobs 테이블
 *        ↕
 *   [로컬 Windows PC] sello:worker  →  claim → runSelloScrape → update
 *
 * 상태 머신:
 *   pending → running → done
 *       ↓              ↘ failed
 *       └→ cancelled
 *
 * 멱등성: (batch_id, keyword) UNIQUE — 같은 배치에 같은 키워드 재등록 방지.
 */
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './companies';
import { users } from './users';

export const SCRAPE_JOB_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;
export type ScrapeJobStatus = (typeof SCRAPE_JOB_STATUSES)[number];

export const scrapeJobs = pgTable(
  'scrape_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 멀티테넌트 키 (P-4)
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    /** 같은 "배치 분석" 요청으로 묶인 jobs 를 그룹화하는 ID */
    batch_id: uuid('batch_id').notNull(),

    /** 스크래핑 대상 키워드 */
    keyword: text('keyword').notNull(),

    /** ScrapeJobStatus */
    status: text('status').notNull().default('pending'),

    /** 캐시 정책 — true 면 워커가 기존 JSON 캐시 무시하고 새로 스크래핑 */
    force_fresh: boolean('force_fresh').notNull().default(false),

    /**
     * 배치 분석 필터 조건 (같은 batch_id 내에서 모두 동일 — 편의상 각 row 에 복사).
     * Shape = BatchFilterCondition (reviewThreshold, minBelowReviewRatio, ...).
     */
    filter_cond: jsonb('filter_cond'),

    /**
     * 스크래핑 결과 = FirstPageMetrics 원본 (rowCount, rocketRatio, reviews[], priceStats, ...).
     * 완료(done) 상태일 때만 채워짐.
     */
    result: jsonb('result'),

    /** 실패 시 에러 메시지 */
    error: text('error'),

    /** 캐시 히트로 스크래핑 안 하고 바로 done 된 경우 true */
    cache_hit: boolean('cache_hit').notNull().default(false),

    /** 워커가 집어간 프로세스 식별자 (hostname-pid) — 멀티 워커 환경 디버깅용 */
    worker_id: text('worker_id'),

    // ─── 시간 추적 ───
    requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    /** 워커 heartbeat — stale running 감지용 (5분 이상 미갱신 → pending 재전환) */
    last_heartbeat_at: timestamp('last_heartbeat_at', { withTimezone: true }),

    /** 요청자 (선택) */
    requested_by: uuid('requested_by').references(() => users.id),
  },
  (t) => [
    // 같은 배치에 동일 키워드 중복 방지
    unique('scrape_jobs_batch_keyword_uniq').on(t.batch_id, t.keyword),

    // 워커 폴링 — pending 중 가장 오래된 것부터
    index('scrape_jobs_pending_idx').on(t.status, t.requested_at),
    // 배치별 조회
    index('scrape_jobs_batch_idx').on(t.batch_id),
    // 회사별 목록
    index('scrape_jobs_company_idx').on(t.company_id, t.requested_at),
  ],
);

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type NewScrapeJob = typeof scrapeJobs.$inferInsert;
