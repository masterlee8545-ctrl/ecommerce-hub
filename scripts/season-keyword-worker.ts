#!/usr/bin/env node
/**
 * season-keyword-worker — 시즌 분석 키워드 풀 자동 갱신
 *
 * 역할:
 *   data/season-keyword-pool.json 의 키워드 풀 (585개) 을 주기적으로 셀록홈즈
 *   chart API 로 갱신해서 keyword_chart_daily 에 저장.
 *
 * 실행:
 *   npm run season:worker                       — 3일 이상 묵은 것만 갱신 (기본)
 *   npm run season:worker -- --all              — 풀 전체 강제 재수집
 *   npm run season:worker -- --limit 50         — 최대 50개만
 *   npm run season:worker -- --max-age-days 1   — 1일 이상 묵은 것만
 *
 * 처리 정책:
 *   - 한번 받으면 영구 캐시 (외부 데이터)
 *   - max-age-days 이상 지난 것 또는 last_status != 'ok' 인 것만 재수집
 *   - 셀록홈즈 rate limit 0.4초 준수
 *   - 인증 만료(401/403) 즉시 중단 — 다음 실행에 이어서
 *
 * 시간 추정:
 *   - 585개 × 0.5초 ≈ 5분 (rate limit 0.4 + DB 쓰기 ~0.1)
 *   - 캐시 hit 비율 80%면 실제 호출 117개 → 1분
 *
 * 종료: Ctrl+C (SIGINT) → 현재 키워드 끝내고 안전하게 멈춤.
 *
 * 자동 실행 (3일 주기) — 형 작업:
 *   Windows Task Scheduler 등록:
 *     - 트리거: 3일마다
 *     - 동작: cmd /c "cd C:\개발\ecommerce-hub && npm run season:worker"
 */
import { eq, lt, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { db } from '../src/db';
import { keywordChartDaily, keywordChartFetches } from '../src/db/schema';
import {
  fetchKeywordChart,
  SellochomesError,
  type SCChartDataPoint,
} from '../src/lib/sellochomes/client';
import { loadKeywordPool } from '../src/lib/sellochomes/keyword-pool';

// ─────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────
const RATE_LIMIT_MS = 400; //                  셀록홈즈 호출 간격
const DEFAULT_MAX_AGE_DAYS = 3; //              형 요청: 3일에 한 번
const PROGRESS_EVERY = 10; //                   진행 상황 출력 주기

interface CliOptions {
  all: boolean;
  limit: number | null;
  maxAgeDays: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { all: false, limit: null, maxAgeDays: DEFAULT_MAX_AGE_DAYS };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--limit') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!isNaN(n) && n > 0) opts.limit = n;
    } else if (arg === '--max-age-days') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!isNaN(n) && n > 0) opts.maxAgeDays = n;
    }
  }
  return opts;
}

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────
let shuttingDown = false;
process.on('SIGINT', () => {
  if (shuttingDown) {
    console.log('\n[worker] 강제 종료');
    process.exit(1);
  }
  shuttingDown = true;
  console.log('\n[worker] 종료 신호 수신 — 현재 키워드 완료 후 종료');
});

async function main() {
  const opts = parseArgs(process.argv);
  const maxAgeMs = opts.maxAgeDays * 24 * 3600 * 1000;

  console.log('[worker] 시즌 키워드 풀 갱신 시작');
  console.log(`[worker] 옵션: all=${opts.all}, limit=${opts.limit ?? '∞'}, maxAge=${opts.maxAgeDays}일`);

  // 1) 풀 로드
  //    파일이 없거나 깨졌으면 loadKeywordPool 이 던진다 (ADR-014).
  //    예전에는 어떤 실패든 빈 배열이라 워커가 "0건 처리 완료" 로 정상 종료했다.
  let pool: string[];
  try {
    pool = await loadKeywordPool();
  } catch (err) {
    console.error(
      `[worker] 키워드 풀을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  console.log(`[worker] 키워드 풀: ${pool.length}개`);
  if (pool.length === 0) {
    console.error('[worker] 풀이 비어있음. data/season-keyword-pool.json 확인.');
    process.exit(1);
  }

  // 2) 갱신 대상 결정
  const toFetch: string[] = [];
  if (opts.all) {
    toFetch.push(...pool);
  } else {
    // DB에서 fetched_at 또는 last_status 확인
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await db
      .select({ keyword: keywordChartFetches.keyword })
      .from(keywordChartFetches)
      .where(
        or(
          lt(keywordChartFetches.fetched_at, cutoff),
          sql`${keywordChartFetches.last_status} != 'ok'`,
        ),
      );
    const staleSet = new Set(stale.map((r) => r.keyword));

    // fetched 한 적 없는 키워드
    const fetched = await db
      .select({ keyword: keywordChartFetches.keyword })
      .from(keywordChartFetches);
    const fetchedSet = new Set(fetched.map((r) => r.keyword));

    for (const kw of pool) {
      if (!fetchedSet.has(kw) || staleSet.has(kw)) {
        toFetch.push(kw);
      }
    }
  }

  // limit 적용
  const target = opts.limit !== null ? toFetch.slice(0, opts.limit) : toFetch;
  console.log(`[worker] 갱신 대상: ${target.length}개 (캐시 히트: ${pool.length - target.length}개)`);

  if (target.length === 0) {
    console.log('[worker] 갱신할 키워드 없음. 모두 신선함. 끝.');
    return;
  }

  // 3) 처리
  const stats = { ok: 0, no_data: 0, error: 0, auth_expired: 0 };
  const startedAt = Date.now();

  for (let i = 0; i < target.length; i++) {
    if (shuttingDown) {
      console.log('[worker] 종료 요청 — 중단');
      break;
    }

    const keyword = target[i];
    if (!keyword) continue;

    try {
      const data = await fetchKeywordChart(keyword);
      if (data.length === 0) {
        await upsertFetchLog(keyword, [], 'no_data');
        stats.no_data++;
      } else {
        await saveDailyToDB(keyword, data);
        await upsertFetchLog(keyword, data, 'ok');
        stats.ok++;
      }
    } catch (err) {
      if (err instanceof SellochomesError) {
        if (err.code === 'auth_expired') {
          stats.auth_expired++;
          console.error(`\n[worker] 🚨 인증 만료 — 즉시 중단. 쿠키 갱신 후 재실행.`);
          await upsertFetchLog(keyword, [], 'auth_expired', err.message);
          break;
        }
        stats.error++;
        await upsertFetchLog(keyword, [], 'error', err.message);
      } else {
        stats.error++;
        const msg = err instanceof Error ? err.message : String(err);
        await upsertFetchLog(keyword, [], 'error', msg);
      }
    }

    if ((i + 1) % PROGRESS_EVERY === 0 || i === target.length - 1) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const eta =
        i < target.length - 1
          ? (((Date.now() - startedAt) / (i + 1)) * (target.length - i - 1) / 1000).toFixed(0)
          : '0';
      console.log(
        `[worker] [${i + 1}/${target.length}] '${keyword}' — ` +
          `ok=${stats.ok} no_data=${stats.no_data} err=${stats.error} (${elapsed}s, ETA ${eta}s)`,
      );
    }

    // rate limit
    if (i < target.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n[worker] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[worker] 완료: ${totalSec}초`);
  console.log(`[worker]   ✅ 성공: ${stats.ok}개`);
  console.log(`[worker]   📭 데이터 없음: ${stats.no_data}개`);
  console.log(`[worker]   ❌ 에러: ${stats.error}개`);
  if (stats.auth_expired > 0) {
    console.log(`[worker]   🚨 인증 만료: ${stats.auth_expired}개 — 쿠키 갱신 필요`);
  }
}

// ─────────────────────────────────────────────────────────
// DB 헬퍼 (API route 와 중복 — 추후 lib 으로 추출)
// ─────────────────────────────────────────────────────────

async function saveDailyToDB(keyword: string, data: SCChartDataPoint[]): Promise<void> {
  if (data.length === 0) return;
  await db.delete(keywordChartDaily).where(eq(keywordChartDaily.keyword, keyword));

  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK).map((d) => ({
      keyword,
      period: d.period,
      ratio: d.ratio,
    }));
    await db.insert(keywordChartDaily).values(chunk);
  }
}

async function upsertFetchLog(
  keyword: string,
  data: SCChartDataPoint[],
  status: 'ok' | 'no_data' | 'error' | 'auth_expired',
  errorMsg?: string,
): Promise<void> {
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
  const start = sorted[0]?.period ?? null;
  const end = sorted[sorted.length - 1]?.period ?? null;

  await db
    .insert(keywordChartFetches)
    .values({
      keyword,
      fetched_at: new Date(),
      data_start_date: start,
      data_end_date: end,
      point_count: data.length,
      last_status: status,
      last_error: errorMsg ?? null,
    })
    .onConflictDoUpdate({
      target: keywordChartFetches.keyword,
      set: {
        fetched_at: new Date(),
        data_start_date: start,
        data_end_date: end,
        point_count: data.length,
        last_status: status,
        last_error: errorMsg ?? null,
      },
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[worker] 치명적 에러:', err);
  process.exit(1);
});
