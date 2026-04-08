/**
 * /notifications — 알림 목록 페이지
 *
 * 출처: docs/DATA_MODEL.md §5.4, D-3b
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-4 (멀티테넌트 RLS),
 *       §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 사용자에게 도착한 알림을 최신순으로 보여줌
 * - 미읽음 / 전체 필터 (URL 파라미터)
 * - 단건 읽음 + 모두 읽음 버튼 (Server Action)
 * - link_url 있으면 클릭 시 해당 페이지로 이동
 *
 * 데이터 흐름:
 * 1. requireCompanyContext() — 인증 + 회사 + 사용자 컨텍스트
 * 2. listNotifications + countUnreadNotifications 병렬
 * 3. URL ?unread=1 이면 미읽음만
 *
 * 보안 (P-4):
 * - userId가 세션에서 추출되므로 다른 사용자 알림 0% 노출
 * - withCompanyContext + user_id 조건 이중 차단
 */
import Link from 'next/link';

import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  Info,
  MailOpen,
} from 'lucide-react';

import { requireCompanyContext } from '@/lib/auth/session';
import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from '@/lib/notifications/actions';
import {
  countUnreadNotifications,
  listNotifications,
  type NotificationSeverity,
} from '@/lib/notifications/queries';

export const dynamic = 'force-dynamic';

const NOTIFICATIONS_LIMIT = 100;

interface NotificationsPageProps {
  searchParams: Promise<{ unread?: string }>;
}

// ─────────────────────────────────────────────────────────
// 심각도 메타
// ─────────────────────────────────────────────────────────

const SEVERITY_META: Record<
  NotificationSeverity,
  { label: string; color: string; icon: typeof Info; ring: string }
> = {
  critical: {
    label: '긴급',
    color: 'text-red-700 bg-red-50',
    ring: 'border-red-300',
    icon: AlertOctagon,
  },
  warning: {
    label: '주의',
    color: 'text-orange-700 bg-orange-50',
    ring: 'border-orange-300',
    icon: AlertTriangle,
  },
  info: {
    label: '정보',
    color: 'text-blue-700 bg-blue-50',
    ring: 'border-blue-200',
    icon: Info,
  },
};

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const ctx = await requireCompanyContext();
  const sp = await searchParams;
  const unreadOnly = sp.unread === '1';

  // DB 조회 — 빈 목록이거나 DB 미준비 시 폴백
  let rows: Awaited<ReturnType<typeof listNotifications>> = [];
  let unreadCount = 0;
  let dbError: string | null = null;

  try {
    [rows, unreadCount] = await Promise.all([
      listNotifications({
        companyId: ctx.companyId,
        userId: ctx.userId,
        unreadOnly,
        limit: NOTIFICATIONS_LIMIT,
      }),
      countUnreadNotifications(ctx.companyId, ctx.userId),
    ]);
  } catch (err) {
    console.error('[notifications] 조회 실패:', err);
    dbError =
      err instanceof Error
        ? `알림 목록 조회 중 오류: ${err.message}`
        : '알림 목록을 불러올 수 없습니다.';
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pink-700">
          <Bell className="h-4 w-4" aria-hidden />알림 센터
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">
              알림
              {unreadCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-pink-100 px-2.5 py-0.5 text-sm font-semibold text-pink-700">
                  {unreadCount}건 미읽음
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-navy-500">
              시스템에서 알려드리는 소식 모음입니다. 작업 할당, 실적 변동, 가격 알림 등이 여기로 옵니다.
            </p>
          </div>

          {unreadCount > 0 && (
            <form action={markAllNotificationsAsReadAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-700 transition hover:border-teal-300 hover:text-teal-700"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                모두 읽음으로
              </button>
            </form>
          )}
        </div>
      </header>

      {/* 필터 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href="/notifications" active={!unreadOnly} label="전체" count={rows.length} />
        <FilterChip
          href="/notifications?unread=1"
          active={unreadOnly}
          label="미읽음"
          count={unreadCount}
          accent="pink"
        />
      </div>

      {/* 본문 */}
      {dbError ? (
        <ErrorPanel message={dbError} />
      ) : rows.length === 0 ? (
        <EmptyPanel unreadOnly={unreadOnly} />
      ) : (
        <ul className="space-y-2">
          {rows.map((notif) => (
            <NotificationRow key={notif.id} notification={notif} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 필터 칩
// ─────────────────────────────────────────────────────────

interface FilterChipProps {
  href: string;
  active: boolean;
  label: string;
  count: number;
  accent?: 'pink';
}

function FilterChip({ href, active, label, count, accent }: FilterChipProps) {
  const baseColor = accent === 'pink' ? 'border-pink-300 bg-pink-50 text-pink-700' : '';
  const className = active
    ? 'rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 transition'
    : `rounded-full border border-navy-200 bg-white px-3 py-1 text-xs font-semibold text-navy-600 transition hover:border-teal-300 hover:text-teal-700 ${baseColor}`;

  return (
    <Link href={href} className={className}>
      {label}
      <span className="ml-1.5 font-mono text-[10px] text-navy-400">{count}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 알림 행
// ─────────────────────────────────────────────────────────

interface NotificationRowProps {
  notification: Awaited<ReturnType<typeof listNotifications>>[number];
}

function NotificationRow({ notification }: NotificationRowProps) {
  const severityMeta =
    SEVERITY_META[notification.severity as NotificationSeverity] ?? SEVERITY_META.info;
  const SeverityIcon = severityMeta.icon;
  const isUnread = !notification.is_read;

  return (
    <li
      className={`rounded-lg border bg-white p-4 transition hover:shadow-sm ${
        isUnread ? `${severityMeta.ring} bg-${notification.severity}-50/20` : 'border-navy-200'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 아이콘 */}
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${severityMeta.color}`}
        >
          <SeverityIcon className="h-4 w-4" aria-hidden />
        </div>

        {/* 본문 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityMeta.color}`}
            >
              {severityMeta.label}
            </span>
            <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-mono text-navy-600">
              {notification.type}
            </span>
            {isUnread && (
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-pink-500" aria-label="읽지 않음" />
            )}
            <span className="text-[10px] text-navy-400">
              {formatRelativeTime(notification.created_at)}
            </span>
          </div>

          <h3
            className={`mt-1.5 text-sm ${
              isUnread ? 'font-semibold text-navy-900' : 'text-navy-700'
            }`}
          >
            {notification.title}
          </h3>

          {notification.body && (
            <p className="mt-1 text-xs text-navy-600">{notification.body}</p>
          )}

          {/* 액션 */}
          <div className="mt-2 flex items-center gap-2">
            {notification.link_url && (
              <Link
                href={notification.link_url}
                className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-700 transition hover:bg-teal-100"
              >
                상세 보기 →
              </Link>
            )}
            {isUnread && (
              <form action={markNotificationAsReadAction}>
                <input type="hidden" name="notificationId" value={notification.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded border border-navy-200 bg-white px-2 py-1 text-[10px] font-semibold text-navy-600 transition hover:border-teal-300 hover:text-teal-700"
                >
                  <MailOpen className="h-3 w-3" aria-hidden />
                  읽음으로
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────
// 빈 / 에러 패널
// ─────────────────────────────────────────────────────────

function EmptyPanel({ unreadOnly }: { unreadOnly: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
      <BellOff className="mx-auto h-10 w-10 text-navy-300" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-navy-700">
        {unreadOnly ? '미읽은 알림이 없습니다' : '아직 받은 알림이 없습니다'}
      </h2>
      <p className="mt-1 text-xs text-navy-500">
        {unreadOnly
          ? '모든 알림을 확인하셨네요! 필터를 "전체"로 바꾸면 지난 알림도 볼 수 있습니다.'
          : '시스템 이벤트(작업 할당, 실적 변동 등)가 발생하면 여기에 자동으로 표시됩니다.'}
      </p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800">
      <div className="font-semibold text-amber-900">알림을 불러올 수 없습니다</div>
      <p className="mt-1 text-xs">{message}</p>
      <p className="mt-2 text-[11px] text-amber-700">
        DB 연결 또는 마이그레이션 적용을 확인하세요. (`npm run db:push`)
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 함수 — 상대 시간
// ─────────────────────────────────────────────────────────

const SEC_PER_MIN = 60;
const MIN_PER_HOUR = 60;
const HOUR_PER_DAY = 24;
const DAY_PER_WEEK = 7;
const MS_PER_SEC = 1000;

function formatRelativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / MS_PER_SEC);
  if (diffSec < SEC_PER_MIN) return '방금 전';
  const diffMin = Math.floor(diffSec / SEC_PER_MIN);
  if (diffMin < MIN_PER_HOUR) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / MIN_PER_HOUR);
  if (diffHour < HOUR_PER_DAY) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / HOUR_PER_DAY);
  if (diffDay < DAY_PER_WEEK) return `${diffDay}일 전`;
  try {
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(date);
  }
}
