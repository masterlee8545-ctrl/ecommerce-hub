/**
 * FlashToast — URL 쿼리 파라미터 `?flash=...` 를 sonner toast 로 변환.
 *
 * 패턴:
 * - 서버 액션이 `redirect('/products/xyz?flash=workflow-saved')` 같은 식으로 리디렉트
 * - 해당 페이지 mount 시 이 컴포넌트가 쿼리 읽음 → toast 표시 → URL 정리 (replace)
 *
 * 지원 flash 코드:
 * - workflow-saved / plan-saved / activity-added / activity-updated
 * - transitioned / quote-accepted
 * - bulk-added:<ok>,<skipped>,<failed>
 * - error:<message>
 */
'use client';

import { useEffect } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { toast } from 'sonner';

const MESSAGES: Record<string, { type: 'success' | 'error' | 'info'; msg: string }> = {
  'workflow-saved': { type: 'success', msg: '워크플로우 저장 완료 (1688 링크 / 담당자)' },
  'plan-saved': { type: 'success', msg: '기획서 저장 완료' },
  'activity-added': { type: 'success', msg: '마케팅 작업 추가됨' },
  'activity-updated': { type: 'success', msg: '마케팅 작업 상태 변경됨' },
  transitioned: { type: 'success', msg: '단계 전환 완료 — 자동 태스크 생성됨' },
  'quote-accepted': { type: 'success', msg: '견적 수락 완료' },
  'basket-added': { type: 'success', msg: '장바구니에 담김' },
};

export function FlashToast() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const flash = params.get('flash');
    if (!flash) return;

    // 배치 담기 결과: bulk-added:3,0,0 형태
    if (flash.startsWith('bulk-added:')) {
      const [ok, skipped, failed] = flash.replace('bulk-added:', '').split(',').map(Number);
      const okN = ok ?? 0;
      const skippedN = skipped ?? 0;
      const failedN = failed ?? 0;
      if (okN > 0 && failedN === 0) {
        toast.success(
          `장바구니 ${okN}개 담김${skippedN > 0 ? ` (중복 ${skippedN}개 스킵)` : ''}`,
        );
      } else if (failedN > 0) {
        toast.error(`담기 ${okN}개 성공 / ${failedN}개 실패`);
      } else {
        toast.info(`새로 담긴 것 없음 (전부 중복)`);
      }
    } else if (flash.startsWith('error:')) {
      toast.error(decodeURIComponent(flash.replace('error:', '')));
    } else {
      const preset = MESSAGES[flash];
      if (preset) {
        if (preset.type === 'success') toast.success(preset.msg);
        else if (preset.type === 'error') toast.error(preset.msg);
        else toast.info(preset.msg);
      }
    }

    // URL 정리 — flash 파라미터 제거
    const next = new URLSearchParams(params.toString());
    next.delete('flash');
    const qs = next.toString();
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [params, router]);

  return null;
}
