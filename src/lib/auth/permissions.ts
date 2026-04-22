/**
 * 역할 기반 권한 체크 (Phase C)
 *
 * 출처: docs/DATA_MODEL.md §2.3 (user_companies.role), src/types/next-auth.d.ts
 * 헌법: CLAUDE.md §1 P-2 (실패 시 throw), §1 P-4 (멀티테넌트 격리)
 *
 * 역할 정의:
 * - owner    — 모든 권한 (회사 설정, 계정 관리 등)
 * - manager  — 사업 데이터 CRUD, 작업 배정, 단계 전환, 배치 시작
 * - operator — 본인에게 배정된 상품만 조회·상태 전환, 배정·가격 편집 불가
 *
 * 설계 원칙:
 * - 순수 함수 (DB 접근 X, async 아님) — 어디서든 호출 가능
 * - assert* 계열은 실패 시 `PermissionError` 던짐 (try/catch 또는 액션 wrapper 에서 캐치)
 * - can* 계열은 boolean — UI 조건부 렌더링용
 * - self-assignment 체크는 상품 객체의 4개 assignee 필드 중 하나라도 일치하면 통과
 */
import type { Product } from '@/db/schema';
import type { CompanyRole } from '@/types/next-auth';

// ─────────────────────────────────────────────────────────
// 에러 타입
// ─────────────────────────────────────────────────────────

export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'requires_manager'
      | 'requires_owner'
      | 'not_assignee'
      | 'not_plan_assignee',
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

// ─────────────────────────────────────────────────────────
// 기본 술어 (can*)
// ─────────────────────────────────────────────────────────

/** owner 또는 manager 인가? (사업 데이터 CRUD 권한) */
export function canManage(role: CompanyRole | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

/** owner 인가? (회사 설정·계정 관리 권한) */
export function canAdmin(role: CompanyRole | null | undefined): boolean {
  return role === 'owner';
}

/**
 * 이 상품의 담당자 중 한 명인가?
 * owner_user_id / plan_assignee_id / listing_assignee_id / rocket_assignee_id 중 하나라도 일치.
 */
export function isAnyAssignee(product: Pick<Product, 'owner_user_id' | 'plan_assignee_id' | 'listing_assignee_id' | 'rocket_assignee_id'>, userId: string): boolean {
  return (
    product.owner_user_id === userId ||
    product.plan_assignee_id === userId ||
    product.listing_assignee_id === userId ||
    product.rocket_assignee_id === userId
  );
}

/** 이 상품의 기획 담당자인가? (Step 4 기획서 편집 권한) */
export function isPlanAssignee(product: Pick<Product, 'plan_assignee_id'>, userId: string): boolean {
  return product.plan_assignee_id === userId;
}

// ─────────────────────────────────────────────────────────
// 복합 권한 (can*)
// ─────────────────────────────────────────────────────────

/** 담당자 배정·1688 링크 등 워크플로우 편집 가능? (manager+) */
export function canEditWorkflow(role: CompanyRole | null | undefined): boolean {
  return canManage(role);
}

/** 가격·원가 편집 가능? (manager+) */
export function canEditPricing(role: CompanyRole | null | undefined): boolean {
  return canManage(role);
}

/** 상품 단계 전환 가능? (manager+ OR 해당 상품 담당자) */
export function canTransitionStatus(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'owner_user_id' | 'plan_assignee_id' | 'listing_assignee_id' | 'rocket_assignee_id'>,
  userId: string,
): boolean {
  return canManage(role) || isAnyAssignee(product, userId);
}

/** 상세 기획서 편집 가능? (manager+ OR plan_assignee) */
export function canEditPlan(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'plan_assignee_id'>,
  userId: string,
): boolean {
  return canManage(role) || isPlanAssignee(product, userId);
}

/** 배치 분석 시작 가능? (manager+) */
export function canStartBatch(role: CompanyRole | null | undefined): boolean {
  return canManage(role);
}

/** 마케팅 활동 작성 가능? (manager+ OR 해당 상품 담당자) */
export function canManageMarketing(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'owner_user_id' | 'plan_assignee_id' | 'listing_assignee_id' | 'rocket_assignee_id'>,
  userId: string,
): boolean {
  return canManage(role) || isAnyAssignee(product, userId);
}

/** 상품 생성 가능? (manager+) */
export function canCreateProduct(role: CompanyRole | null | undefined): boolean {
  return canManage(role);
}

// ─────────────────────────────────────────────────────────
// Assert (서버 액션용 — 실패 시 throw)
// ─────────────────────────────────────────────────────────

export function assertManager(role: CompanyRole | null | undefined, actionName: string): void {
  if (!canManage(role)) {
    throw new PermissionError(
      `"${actionName}" 은(는) 매니저 이상 권한이 필요합니다. (현재: ${role ?? 'none'})`,
      'requires_manager',
    );
  }
}

export function assertOwner(role: CompanyRole | null | undefined, actionName: string): void {
  if (!canAdmin(role)) {
    throw new PermissionError(
      `"${actionName}" 은(는) 오너 권한이 필요합니다. (현재: ${role ?? 'none'})`,
      'requires_owner',
    );
  }
}

export function assertCanTransitionStatus(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'owner_user_id' | 'plan_assignee_id' | 'listing_assignee_id' | 'rocket_assignee_id'>,
  userId: string,
): void {
  if (!canTransitionStatus(role, product, userId)) {
    throw new PermissionError(
      '상품 단계 전환은 매니저 이상 또는 해당 상품 담당자만 가능합니다.',
      'not_assignee',
    );
  }
}

export function assertCanEditPlan(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'plan_assignee_id'>,
  userId: string,
): void {
  if (!canEditPlan(role, product, userId)) {
    throw new PermissionError(
      '기획서 편집은 매니저 이상 또는 기획 담당자만 가능합니다.',
      'not_plan_assignee',
    );
  }
}

export function assertCanManageMarketing(
  role: CompanyRole | null | undefined,
  product: Pick<Product, 'owner_user_id' | 'plan_assignee_id' | 'listing_assignee_id' | 'rocket_assignee_id'>,
  userId: string,
): void {
  if (!canManageMarketing(role, product, userId)) {
    throw new PermissionError(
      '마케팅 활동은 매니저 이상 또는 해당 상품 담당자만 작성할 수 있습니다.',
      'not_assignee',
    );
  }
}

// ─────────────────────────────────────────────────────────
// 역할 라벨 (UI용)
// ─────────────────────────────────────────────────────────

export function roleLabel(role: CompanyRole | null | undefined): string {
  switch (role) {
    case 'owner':
      return '오너';
    case 'manager':
      return '매니저';
    case 'operator':
      return '실무자';
    default:
      return '알 수 없음';
  }
}
