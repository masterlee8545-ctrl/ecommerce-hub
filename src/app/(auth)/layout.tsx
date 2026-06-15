/**
 * 인증 페이지 공통 레이아웃 ((auth) 라우트 그룹)
 *
 * 출처: Next.js App Router 라우트 그룹 패턴
 *
 * 역할:
 * - /login, /register 등 인증 관련 페이지의 공통 껍데기
 * - 가운데 정렬된 카드 레이아웃
 * - 메인 앱 layout 위에 추가로 감싸는 구조
 *
 * 라우트 그룹 (auth) 의미:
 * - URL에는 영향 없음 (/login은 그대로)
 * - 폴더 단위로 별도의 layout 적용 가능
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="auth-bg flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* 로고 */}
        <div className="mb-7 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-2xl font-black text-white shadow-lg shadow-teal-600/25">
            B
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-navy-900">
            BUYWISE.CO
          </h1>
          <p className="mt-1 text-sm text-navy-500">이커머스 통합관리 · 6단계 파이프라인</p>
        </div>

        {/* 카드 */}
        <div className="card-soft rounded-2xl p-8">
          {children}
        </div>

        {/* 푸터 */}
        <p className="mt-6 text-center text-xs text-navy-400">
          © 2026 BUYWISE.CO · 내부 시스템
        </p>
      </div>
    </div>
  );
}
