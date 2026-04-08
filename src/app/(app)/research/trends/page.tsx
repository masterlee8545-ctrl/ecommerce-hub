/**
 * /research/trends — InfoHub 트렌드 카드 페이지
 *
 * 출처: docs/INFOHUB_INTEGRATION.md, ADR-011, C-4 Phase 1 MVP
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-3 (estimated 마킹),
 *       §1 P-8 (형제 프로젝트 응답 스키마 가정 금지), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - InfoHub REST API에서 키워드별 트렌드 카드(유튜브/블로그/뉴스 등)를 가져와 표시
 * - 호출 실패 시 친절한 한국어 안내 (P-9) — 페이지가 절대 깨지지 않게
 * - 모든 카드는 🟡 estimated 배지 (P-3 + ADR-011)
 *
 * 데이터 흐름:
 * 1. 인증 검증 (requireCompanyContext)
 * 2. URL ?q= 쿼리스트링에서 키워드 추출 (없으면 기본값)
 * 3. searchInfoHubTrends() 호출 — try/catch로 모든 에러 분류
 * 4. 결과를 카테고리별 배지와 함께 카드 그리드로 렌더
 *
 * 에러 분류 (P-9):
 * - config 누락 → "InfoHub 연결 설정이 아직 안 됐어요" + 관리자 안내
 * - 네트워크/타임아웃 → "InfoHub 서버에 연결할 수 없어요" + 재시도 버튼
 * - 스키마 불일치 → "InfoHub 응답 형식이 바뀌었어요" + bugs.md 안내
 */
import Link from 'next/link';

import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import {
  searchInfoHubTrends,
  type SearchTrendsResult,
} from '@/lib/infohub/client';
import {
  InfoHubCallError,
  InfoHubSchemaError,
  type InfoHubItem,
} from '@/lib/infohub/schema';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const DEFAULT_QUERY = '이커머스 트렌드';
const ITEMS_LIMIT = 12;
const SEC_PER_MIN = 60;
const MIN_PER_HOUR = 60;
const MS_PER_SEC = 1000;

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function TrendsPage({ searchParams }: PageProps) {
  await requireCompanyContext();

  const params = await searchParams;
  const query = (params.q ?? '').trim() || DEFAULT_QUERY;

  // InfoHub 호출 — 에러는 분류해서 표시
  type FetchOutcome =
    | { kind: 'success'; data: SearchTrendsResult }
    | { kind: 'config-error'; message: string }
    | { kind: 'network-error'; message: string }
    | { kind: 'schema-error'; message: string };

  let outcome: FetchOutcome;
  try {
    const data = await searchInfoHubTrends({ query, limit: ITEMS_LIMIT });
    outcome = { kind: 'success', data };
  } catch (err) {
    if (err instanceof InfoHubSchemaError) {
      outcome = {
        kind: 'schema-error',
        message:
          'InfoHub 응답 형식이 우리 시스템이 기대하는 것과 다릅니다. 개발팀에 보고가 필요합니다.',
      };
    } else if (err instanceof InfoHubCallError) {
      // config 단계 실패 — endpoint가 'config'
      if (err.endpoint === 'config') {
        outcome = {
          kind: 'config-error',
          message: err.message,
        };
      } else {
        outcome = {
          kind: 'network-error',
          message:
            'InfoHub 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. (네트워크 또는 타임아웃)',
        };
      }
    } else {
      outcome = {
        kind: 'network-error',
        message:
          err instanceof Error
            ? `예상치 못한 오류: ${err.message}`
            : '알 수 없는 오류가 발생했습니다.',
      };
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href="/research"
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          리서치로 돌아가기
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">키워드 트렌드</h1>
            <p className="mt-1 text-sm text-navy-500">
              InfoHub에서 모은 최신 콘텐츠(유튜브 / 블로그 / 뉴스)를 한눈에 봅니다.
            </p>
          </div>
          <span className="rounded bg-yellow-50 px-2 py-1 text-[10px] font-semibold text-yellow-700">
            🟡 추정값 (ADR-011)
          </span>
        </div>
      </header>

      {/* 검색 폼 (GET 방식) */}
      <form
        action="/research/trends"
        method="get"
        className="flex items-center gap-2 rounded-lg border border-navy-200 bg-white p-3"
      >
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="검색 키워드 (예: 실리콘 주방용품)"
          className="flex-1 rounded-md border border-navy-200 bg-white px-3 py-1.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          새로 가져오기
        </button>
      </form>

      {/* 결과 영역 */}
      {outcome.kind === 'success' ? (
        <SuccessSection result={outcome.data} query={query} />
      ) : (
        <ErrorSection
          variant={outcome.kind}
          message={outcome.message}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 성공 섹션
// ─────────────────────────────────────────────────────────

function SuccessSection({
  result,
  query,
}: {
  result: SearchTrendsResult;
  query: string;
}) {
  // P-1: 빈 결과는 명시적으로 표시
  if (result.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
        <h2 className="mt-3 text-base font-semibold text-navy-700">
          &ldquo;{query}&rdquo; 키워드로 가져온 자료가 없습니다.
        </h2>
        <p className="mt-1 text-xs text-navy-500">
          다른 키워드로 검색하거나, InfoHub에서 먼저 자료 수집을 실행해보세요.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 메타 정보 */}
      <div className="flex items-center justify-between text-xs text-navy-500">
        <span>
          총 <span className="font-semibold text-navy-900">{result.total}</span>건 중{' '}
          <span className="font-semibold text-navy-900">{result.items.length}</span>건 표시
        </span>
        <span>
          {result.cached ? '캐시 사용' : '방금 가져옴'} ·{' '}
          {formatRelativeTime(result.fetchedAt)}
        </span>
      </div>

      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {result.items.map((item) => (
          <TrendCard key={item.id} item={item} />
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// 에러 섹션
// ─────────────────────────────────────────────────────────

function ErrorSection({
  variant,
  message,
}: {
  variant: 'config-error' | 'network-error' | 'schema-error';
  message: string;
}) {
  const titleMap = {
    'config-error': 'InfoHub 연결 설정이 아직 안 됐어요',
    'network-error': 'InfoHub 서버에 연결할 수 없어요',
    'schema-error': 'InfoHub 응답 형식이 바뀌었어요',
  } as const;

  const helpMap = {
    'config-error':
      '관리자에게 .env.local의 INFOHUB_URL과 INFOHUB_AUTH_TOKEN을 채워달라고 요청하세요.',
    'network-error': '잠시 후 다시 시도해주세요. 계속되면 관리자에게 문의하세요.',
    'schema-error':
      '개발팀이 agents/bugs.md에 새 버그 항목을 추가하고 스키마를 업데이트해야 합니다 (B-001 사례 참고).',
  } as const;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-amber-900">{titleMap[variant]}</h2>
          <p className="text-sm text-amber-800">{message}</p>
          <p className="text-xs text-amber-700">{helpMap[variant]}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────

function TrendCard({ item }: { item: InfoHubItem }) {
  // 출처에 따른 색상
  const sourceLabel = item.source.replace(/^infohub:/, '');
  const sourceBgClass = pickSourceColor(sourceLabel);

  // 본문 미리보기 (description 우선, 없으면 body_text)
  const PREVIEW_CHAR_LIMIT = 140;
  const preview = (item.description || item.body_text || '').slice(0, PREVIEW_CHAR_LIMIT);

  return (
    <article className="flex h-full flex-col rounded-lg border border-navy-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm">
      {/* 출처 + 신뢰도 */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${sourceBgClass}`}
        >
          {sourceLabel}
        </span>
        <span className="rounded bg-yellow-50 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700">
          🟡 estimated
        </span>
      </div>

      {/* 제목 */}
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-navy-900">{item.title}</h3>

      {/* 본문 */}
      {preview && (
        <p className="mt-2 line-clamp-3 text-xs text-navy-600">{preview}</p>
      )}

      {/* 지식 카드 요약 (있으면) */}
      {item.knowledge?.knowledge_summary && (
        <div className="mt-2 rounded bg-navy-50/50 px-2 py-1.5 text-[11px] text-navy-700">
          <span className="font-semibold text-navy-900">AI 요약:</span>{' '}
          <span className="line-clamp-2">{item.knowledge.knowledge_summary}</span>
        </div>
      )}

      {/* 푸터 */}
      <div className="mt-auto pt-3 flex items-center justify-between text-[11px] text-navy-400">
        <span>{formatPublishedDate(item.published_at)}</span>
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-800"
        >
          원문
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

function pickSourceColor(source: string): string {
  if (source.includes('youtube')) return 'bg-rose-50 text-rose-700';
  if (source.includes('blog') || source.includes('naver')) return 'bg-emerald-50 text-emerald-700';
  if (source.includes('news')) return 'bg-blue-50 text-blue-700';
  if (source.includes('reddit')) return 'bg-orange-50 text-orange-700';
  return 'bg-navy-50 text-navy-700';
}

function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.round((Date.now() - epochMs) / MS_PER_SEC);
  if (diffSec < SEC_PER_MIN) return '방금 전';
  const diffMin = Math.round(diffSec / SEC_PER_MIN);
  if (diffMin < MIN_PER_HOUR) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / MIN_PER_HOUR);
  return `${diffHour}시간 전`;
}

function formatPublishedDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}
