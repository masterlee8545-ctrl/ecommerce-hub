/**
 * 아이템 스카우트 토큰 입력 폼 (클라이언트 컴포넌트)
 *
 * 역할:
 * - i_token 붙여넣기 + 저장
 * - 연결 상태 표시 (연결됨 / 미연결)
 * - 저장 시 자동 유효성 검증
 */
'use client';

import { useState, useTransition } from 'react';

import { CheckCircle2, Loader2, Save, XCircle } from 'lucide-react';

import { saveItemScoutTokenAction } from '@/lib/itemscout/actions';

interface ItemScoutTokenFormProps {
  isConnected: boolean;
}

export function ItemScoutTokenForm({ isConnected }: ItemScoutTokenFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [connected, setConnected] = useState(isConnected);

  const handleSubmit = (formData: FormData) => {
    setResult(null);
    startTransition(async () => {
      try {
        await saveItemScoutTokenAction(formData);
        setResult({ ok: true, message: '토큰이 저장되었습니다. 상품 발굴에서 카테고리 탐색을 사용할 수 있습니다.' });
        setConnected(true);
      } catch (err) {
        setResult({
          ok: false,
          message: err instanceof Error ? err.message : '토큰 저장에 실패했습니다.',
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* 연결 상태 */}
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-700">연결됨</span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-navy-400" />
            <span className="text-xs font-semibold text-navy-500">미연결</span>
          </>
        )}
      </div>

      {/* 토큰 입력 */}
      <form action={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="is-token" className="block text-xs font-semibold text-navy-700">
            i_token 값
          </label>
          <input
            type="text"
            id="is-token"
            name="token"
            placeholder="아이템스카우트 쿠키에서 복사한 i_token 값"
            className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 font-mono text-xs text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            disabled={isPending}
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {isPending ? '확인 중...' : '저장'}
        </button>
      </form>

      {/* 결과 메시지 */}
      {result && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            result.ok
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
