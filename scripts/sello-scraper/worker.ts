#!/usr/bin/env node
/**
 * sello-worker — 로컬 Windows PC 상시 프로세스 (스크래핑 큐 consumer)
 *
 * 실행: npm run sello:worker
 *
 * 역할:
 * - Supabase scrape_jobs 테이블을 5초마다 폴링
 * - pending 상태 job 하나 atomic claim (FOR UPDATE SKIP LOCKED)
 * - 캐시 확인 (TTL 24h) → 유효하면 바로 done, 없으면 runSelloScrape 실행
 * - 결과를 scrape_jobs.result jsonb 에 저장
 * - heartbeat 5분 이상 끊긴 running job 자동 복구 (claim 단계에서 처리)
 *
 * 종료: Ctrl+C (SIGINT) → 현재 돌던 job 은 끝까지 돌리고 종료
 *
 * 배포 메모:
 * - 이 워커는 **Windows 로컬 PC 에서만 동작** (Playwright + Chrome 필요)
 * - Vercel serverless 에 올리지 말 것
 * - PC 꺼지면 worker 도 정지 → 다시 켜고 `npm run sello:worker` 재실행하면 이어서 처리
 */
import { hostname } from 'node:os';

import { loadSelloScrape } from '../../src/lib/sello-scraper/adapter';
import {
  claimNextPendingJob,
  completeJob,
  failJob,
  heartbeat,
} from '../../src/lib/sello-scraper/job-queue';
import { getCoupangFirstPageMetrics } from '../../src/lib/sello-scraper/metrics';
import { DEFAULT_CACHE_TTL_MS } from '../../src/lib/sello-scraper/constants';
import { runSelloScrape } from '../../src/lib/sello-scraper/run-scrape';

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60_000; // 1분마다

const WORKER_ID = `${hostname()}-${process.pid}`;

let shuttingDown = false;

// ─────────────────────────────────────────────────────────
// 시그널 핸들러 — 깨끗한 종료
// ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  if (shuttingDown) {
    console.log('\n[worker] 강제 종료');
    process.exit(1);
  }
  shuttingDown = true;
  console.log('\n[worker] 종료 신호 수신 — 현재 작업 완료 후 종료합니다 (재차 Ctrl+C 누르면 강제 종료)');
});
process.on('SIGTERM', () => {
  shuttingDown = true;
});

// ─────────────────────────────────────────────────────────
// 캐시 TTL 체크 — 워커에서 불필요한 스크래핑 회피
// ─────────────────────────────────────────────────────────

async function getFreshCachedMetrics(
  keyword: string,
): Promise<{ metrics: unknown; source: 'hub' | 'buywise' } | null> {
  const metrics = await getCoupangFirstPageMetrics(keyword);
  if (!metrics) return null;
  if (metrics.cacheAgeMs > DEFAULT_CACHE_TTL_MS) return null;
  return { metrics, source: metrics.source };
}

// ─────────────────────────────────────────────────────────
// 하나의 job 처리
// ─────────────────────────────────────────────────────────

async function processOneJob(): Promise<'processed' | 'idle'> {
  const job = await claimNextPendingJob(WORKER_ID);
  if (!job) return 'idle';

  console.log(
    `[worker] claim: ${job.keyword} (batch=${job.batch_id.slice(0, 8)} force=${job.force_fresh})`,
  );

  // heartbeat 타이머 — job 처리 중 1분마다 갱신
  const heartbeatTimer = setInterval(() => {
    heartbeat(job.id).catch((e) => {
      console.warn(`[worker] heartbeat 실패 (${job.id}):`, e);
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // 1) 캐시 TTL 체크 (force_fresh 아니면)
    if (!job.force_fresh) {
      const cached = await getFreshCachedMetrics(job.keyword);
      if (cached) {
        console.log(`[worker]   📦 캐시 히트 (TTL 내) — 즉시 완료`);
        await completeJob(job.id, cached.metrics, { cacheHit: true });
        clearInterval(heartbeatTimer);
        return 'processed';
      }
    }

    // 2) 실제 스크래핑
    //    fastMode=true → 리뷰만 가져오고 즉시 종료 (~15s/키워드, 기존 ~3분 대비 12배 빠름)
    //    배치 분석 use case 는 리뷰 분포가 핵심 → fast 가 기본.
    //    판매량/조회수 디테일이 필요하면 SELLO_FAST_MODE=0 으로 풀모드 강제.
    const fastMode = process.env['SELLO_FAST_MODE'] !== '0';
    const startedAt = Date.now();
    const result = await runSelloScrape(job.keyword, {
      fastMode,
      onProgress: (m) => console.log(`[worker]   ${m}`),
    });
    const durationSec = Math.round((Date.now() - startedAt) / 1000);

    if (!result.ok) {
      console.error(
        `[worker]   ❌ 실패 (${durationSec}s) reason=${result.reason}: ${result.error}`,
      );
      await failJob(job.id, `[${result.reason}] ${result.error}`);
      clearInterval(heartbeatTimer);
      return 'processed';
    }

    // 3) 스크래핑 완료 → 캐시에서 정규화된 FirstPageMetrics 재로드
    //    (파일 저장 + metrics 계산이 분리돼 있어서 한 번 더 읽음)
    const metrics = await getCoupangFirstPageMetrics(job.keyword);
    if (!metrics) {
      await failJob(
        job.id,
        `스크래핑 완료됐으나 metrics 로드 실패 — JSON 파일 확인`,
      );
      clearInterval(heartbeatTimer);
      return 'processed';
    }

    console.log(
      `[worker]   ✅ 완료 (${durationSec}s) rows=${metrics.rowCount} rocket=${Math.round(metrics.rocketRatio * 100)}%`,
    );
    await completeJob(job.id, metrics, { cacheHit: false });
    clearInterval(heartbeatTimer);
    return 'processed';
  } catch (err) {
    clearInterval(heartbeatTimer);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker]   💥 예외: ${msg}`);
    await failJob(job.id, msg).catch(() => {
      /* 최악의 경우 DB 도 먹통 — 무시 */
    });
    return 'processed';
  }
}

// ─────────────────────────────────────────────────────────
// 메인 루프
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[worker] 시작 — id=${WORKER_ID}`);
  console.log(`[worker] 폴링 주기: ${POLL_INTERVAL_MS}ms`);
  console.log(`[worker] 중단: Ctrl+C\n`);

  while (!shuttingDown) {
    try {
      const outcome = await processOneJob();
      if (outcome === 'idle') {
        // pending 없음 → sleep
        await sleep(POLL_INTERVAL_MS);
      }
      // processed 면 곧바로 다음 job 시도 (스레싱 안 쌓이게)
    } catch (err) {
      console.error(`[worker] 루프 에러:`, err);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log('[worker] 종료');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // 종료 시그널 시 빠르게 깨어나게
    const check = setInterval(() => {
      if (shuttingDown) {
        clearTimeout(t);
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => clearInterval(check), ms);
  });
}

main().catch((err: unknown) => {
  console.error('[worker] 치명적 에러:', err instanceof Error ? err.stack : err);
  process.exit(1);
});

// `loadSelloScrape` 는 잠재적 import cycle 방지 목적으로 유지 (쓰이진 않음)
void loadSelloScrape;
