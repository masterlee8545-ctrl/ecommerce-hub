/**
 * 대시보드 통계 헬퍼
 *
 * 출처: docs/SPEC.md (홈 대시보드 KPI)
 * 헌법: CLAUDE.md §1 P-3 (신뢰도 마킹), §1 P-4 (멀티테넌트)
 *
 * 역할:
 * - 회사별 5단계 파이프라인 단계별 상품 수 집계
 * - 미해결 작업 수, 미읽은 알림 수
 *
 * 모든 함수는 withCompanyContext 안에서 호출되어야 함 (P-4).
 */
import { and, count, eq, sql } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { notifications, products, tasks } from '@/db/schema';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export type PipelineStage =
  | 'research'
  | 'sourcing'
  | 'importing'
  | 'listing'
  | 'active';

export interface PipelineStageCount {
  stage: PipelineStage;
  count: number;
}

export interface DashboardStats {
  pipelineCounts: PipelineStageCount[];
  totalProducts: number;
  openTasks: number;
  unreadNotifications: number;
}

// ─────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────

const ALL_STAGES: PipelineStage[] = [
  'research',
  'sourcing',
  'importing',
  'listing',
  'active',
];

/**
 * 대시보드 통계 조회 (회사 컨텍스트 필요).
 *
 * 안전성:
 * - withCompanyContext로 RLS 자동 차단
 * - 다른 회사 데이터는 절대 보이지 않음
 *
 * 실패 처리:
 * - DB 미연결 시 모든 카운트가 0인 객체 반환 (페이지가 깨지지 않게)
 * - 진짜 에러는 console.error 로만 (P-2 디버깅용)
 */
export async function getDashboardStats(companyId: string): Promise<DashboardStats> {
  try {
    return await withCompanyContext(companyId, async (tx) => {
      // 1) 파이프라인 단계별 카운트 (한 번의 쿼리)
      const stageRows = await tx
        .select({
          stage: products.status,
          n: count(),
        })
        .from(products)
        .where(eq(products.company_id, companyId))
        .groupBy(products.status);

      const stageMap = new Map<string, number>();
      for (const row of stageRows) {
        stageMap.set(row.stage, Number(row.n));
      }

      const pipelineCounts: PipelineStageCount[] = ALL_STAGES.map((stage) => ({
        stage,
        count: stageMap.get(stage) ?? 0,
      }));

      const totalProducts = pipelineCounts.reduce((sum, s) => sum + s.count, 0);

      // 2) 미해결 작업 수
      const openTaskRows = await tx
        .select({ n: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.company_id, companyId),
            sql`${tasks.status} NOT IN ('done', 'cancelled')`,
          ),
        );
      const openTasks = Number(openTaskRows[0]?.n ?? 0);

      // 3) 미읽은 알림 수
      const unreadRows = await tx
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.company_id, companyId), eq(notifications.is_read, false)));
      const unreadNotifications = Number(unreadRows[0]?.n ?? 0);

      return {
        pipelineCounts,
        totalProducts,
        openTasks,
        unreadNotifications,
      };
    });
  } catch (error) {
    // DB 미연결/마이그레이션 미적용 등 — 페이지는 떠야 함
    console.error('[dashboard.stats] 조회 실패:', error);
    return {
      pipelineCounts: ALL_STAGES.map((stage) => ({ stage, count: 0 })),
      totalProducts: 0,
      openTasks: 0,
      unreadNotifications: 0,
    };
  }
}
