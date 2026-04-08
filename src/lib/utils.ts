/**
 * 공통 유틸 함수
 *
 * 출처: shadcn/ui 표준 헬퍼
 *
 * 역할:
 * - cn(): clsx + tailwind-merge — Tailwind 클래스 안전 병합
 *   "px-2 px-4" → "px-4" (뒤에 오는 게 이김)
 *
 * 사용:
 * ```tsx
 * <div className={cn('px-2 py-1', isActive && 'bg-teal-100', className)} />
 * ```
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind 클래스 병합 유틸.
 * - clsx: 조건부 클래스 (객체/배열/falsy 처리)
 * - twMerge: 같은 카테고리 클래스 충돌 해결 (마지막 값 우선)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
