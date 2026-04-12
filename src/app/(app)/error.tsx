'use client';

import { AlertTriangle } from 'lucide-react';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-8 w-8 text-red-400" />
      </div>
      <h1 className="text-xl font-bold text-navy-900">문제가 발생했어요</h1>
      <p className="max-w-sm text-sm text-navy-500">
        일시적인 오류일 수 있습니다. 아래 버튼을 눌러 다시 시도해보세요.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
      >
        다시 시도
      </button>
    </div>
  );
}
