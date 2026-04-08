/**
 * 회사 도메인 — 인증 컨텍스트 보조
 *
 * 출처: docs/DATA_MODEL.md §2.1 (companies 표)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트)
 *
 * 역할:
 * - 사용자가 속한 회사들의 이름·메타데이터 조회 (회사 전환 UI용)
 * - 멤버십 검증 (다른 회사로 무단 전환 차단)
 *
 * 멀티테넌트 안전성:
 * - 이 함수는 db 직접 사용 (RLS 우회) — 사용자가 속한 회사 ID로 명시적 필터링하므로 안전
 * - 절대 임의의 companyId를 받아서 그대로 쿼리하면 안 됨 (반드시 멤버십 검증 후)
 */
import { inArray } from 'drizzle-orm';

import { db } from '@/db';
import { companies } from '@/db/schema';
import type { CompanyRole } from '@/types/next-auth';

import { listUserCompanies } from './user';

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export interface CompanyWithRole {
  id: string;
  name: string;
  businessType: 'industrial' | 'agricultural' | 'other';
  role: CompanyRole;
}

// ─────────────────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────────────────

/**
 * 사용자가 속한 모든 회사의 이름·역할 조회.
 *
 * 사용처: 헤더의 회사 전환 드롭다운
 *
 * 동작:
 * 1. user_companies에서 사용자의 회사 ID + 역할 조회
 * 2. companies 표에서 IN 절로 한 번에 이름 조회 (N+1 회피)
 * 3. ID 매칭해서 합침
 */
export async function listCompaniesForUser(userId: string): Promise<CompanyWithRole[]> {
  if (!userId) {
    return [];
  }

  // 1) 멤버십 가져오기
  const memberships = await listUserCompanies(userId);
  if (memberships.length === 0) {
    return [];
  }

  // 2) 회사 이름·타입 한 번에 조회
  const companyIds = memberships.map((m) => m.companyId);
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      businessType: companies.business_type,
    })
    .from(companies)
    .where(inArray(companies.id, companyIds));

  // 3) ID 매칭 (멤버십 순서 유지)
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result: CompanyWithRole[] = [];
  for (const m of memberships) {
    const company = byId.get(m.companyId);
    if (!company) continue; // 회사가 삭제됐을 수 있음 — skip

    // business_type은 DB에서 text라 런타임 검증 필요
    const validTypes = ['industrial', 'agricultural', 'other'] as const;
    const businessType = validTypes.find((t) => t === company.businessType) ?? 'other';

    result.push({
      id: company.id,
      name: company.name,
      businessType,
      role: m.role,
    });
  }

  return result;
}
