/**
 * /research/season-pulse — 시즌 자동 추천 대시보드
 *
 * 형이 페이지 켜면 *이미 분류된* 시즌 후보가 그룹별로 떠 있음.
 * - 🚨 지금 소싱 시작 (5점 — 다음달 피크의 준비월)
 * - 📅 이번달 급상승 (4점)
 * - ⏳ 다음달 피크 (2점)
 * - 📈 진행 중 (1점)
 *
 * 데이터: /api/season-recommendations?month=N
 * 캐시된 549개 키워드를 클라이언트 요청 시 분석 (~3초).
 */
import { requireCompanyContext } from '@/lib/auth/session';

import { SeasonPulseClient } from './season-pulse-client';

export const dynamic = 'force-dynamic';

export default async function SeasonPulsePage() {
  // 인증 강제 (멀티테넌트 격리)
  await requireCompanyContext();

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900">🌊 시즌 펄스</h1>
        <p className="mt-2 text-base text-navy-500">
          캐시된 키워드 풀을 자동 분석해서 *지금 준비해야 할* 시즌 키워드를 그룹별로 추천합니다.
        </p>
      </header>

      <SeasonPulseClient />
    </div>
  );
}
