/**
 * /settings — 회사/사용자 설정
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화)
 *
 * 역할:
 * - 현재 로그인 사용자 정보 표시
 * - 활성 회사 정보 + 멤버십
 * - 파이프라인 현황 요약
 */
import {
  BarChart3,
  Building2,
  Link2,
  Mail,
  Settings,
  Shield,
  User,
  Users,
} from 'lucide-react';

import { ItemScoutTokenForm } from '@/components/settings/itemscout-token-form';
import { requireCompanyContext } from '@/lib/auth/session';
import { getDashboardStats } from '@/lib/dashboard/stats';
import { hasItemScoutToken } from '@/lib/itemscout/client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireCompanyContext();
  const [stats, isItemScoutConnected] = await Promise.all([
    getDashboardStats(ctx.companyId),
    hasItemScoutToken(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* 헤더 */}
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
          <Settings className="h-4 w-4" aria-hidden />
          설정
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">설정</h1>
        <p className="mt-1 text-sm text-navy-500">
          회사 정보와 계정을 관리합니다.
        </p>
      </header>

      {/* 사용자 정보 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <User className="h-4 w-4 text-teal-600" />
          내 계정
        </h2>
        <div className="mt-3 space-y-2">
          <InfoRow icon={Mail} label="이메일" value={ctx.email} />
          <InfoRow icon={User} label="이름" value={ctx.name || '(미설정)'} />
          <InfoRow icon={Shield} label="권한" value={roleLabel(ctx.role)} />
        </div>
      </section>

      {/* 회사 정보 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <Building2 className="h-4 w-4 text-teal-600" />
          활성 회사
        </h2>
        <div className="mt-3 space-y-2">
          <InfoRow
            icon={Building2}
            label="회사 ID"
            value={ctx.companyId}
            mono
          />
          <InfoRow
            icon={Users}
            label="멤버십"
            value={`${ctx.memberships.length}개 회사에 소속`}
          />
        </div>
      </section>

      {/* 파이프라인 현황 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <BarChart3 className="h-4 w-4 text-teal-600" />
          파이프라인 현황
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          {stats.pipelineCounts.map((entry) => (
            <div
              key={entry.stage}
              className="rounded-md border border-navy-100 bg-navy-50/40 p-3 text-center"
            >
              <div className="text-[10px] font-semibold uppercase text-navy-500">
                {stageLabel(entry.stage)}
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums text-navy-800">
                {entry.count}
              </div>
            </div>
          ))}
          <div className="rounded-md border border-teal-200 bg-teal-50/40 p-3 text-center">
            <div className="text-[10px] font-semibold uppercase text-teal-700">전체</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-teal-700">
              {stats.totalProducts}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-navy-500">
          <span>미해결 작업: <strong className="text-navy-700">{stats.openTasks}건</strong></span>
          <span>미읽은 알림: <strong className="text-navy-700">{stats.unreadNotifications}건</strong></span>
        </div>
      </section>

      {/* 아이템 스카우트 연결 */}
      <section className="rounded-lg border border-navy-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <Link2 className="h-4 w-4 text-teal-600" />
          아이템 스카우트 연결
        </h2>
        <p className="mt-1 text-xs text-navy-500">
          아이템스카우트에서 카테고리/키워드 데이터를 가져오려면 토큰이 필요합니다.
        </p>
        <div className="mt-3">
          <ItemScoutTokenForm isConnected={isItemScoutConnected} />
        </div>
        <div className="mt-2 rounded-md bg-navy-50/50 p-3">
          <p className="text-[11px] text-navy-500">
            <strong className="text-navy-700">토큰 가져오는 방법:</strong>{' '}
            itemscout.io에 로그인 → 개발자 도구(F12) → Application → Cookies → i_token 값 복사
          </p>
        </div>
      </section>

      {/* 앞으로 추가될 기능 안내 */}
      <section className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-5">
        <h2 className="text-sm font-semibold text-navy-700">준비중인 설정</h2>
        <ul className="mt-2 space-y-1 text-xs text-navy-500">
          <li>- 회사 이름/로고 변경</li>
          <li>- 직원 초대 및 권한 관리</li>
          <li>- 쿠팡 수수료율 기본값 설정</li>
          <li>- BW Rank / 아이템 스카우트 API 연결</li>
          <li>- 수입대행 업체 폼 링크 생성</li>
        </ul>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof User;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-navy-400" aria-hidden />
      <span className="w-16 shrink-0 text-xs font-semibold text-navy-500">{label}</span>
      <span className={`text-navy-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'owner':
      return '소유자 (Owner)';
    case 'admin':
      return '관리자 (Admin)';
    case 'member':
      return '멤버 (Member)';
    default:
      return role;
  }
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'research':
      return '상품 발굴';
    case 'sourcing':
      return '수입 의뢰';
    case 'importing':
      return '수입중';
    case 'listing':
      return '등록';
    case 'active':
      return '런칭';
    default:
      return stage;
  }
}
