/**
 * /products/[id]/plan — 상세페이지 기획서 편집 (Step 4)
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-9 (사용자 친화 한국어)
 *
 * 역할:
 * - 상품별 상세페이지 기획서 작성·수정
 * - AI 초안 프롬프트 미리보기 (쿠팡 1페이지 top5 + 리뷰 불만포인트 포함)
 * - 사용자는 프롬프트를 복사해서 Claude/ChatGPT 에 붙여넣고 결과를 섹션 JSON 으로 저장
 *
 * 보안: requireCompanyContext — 활성 법인의 상품만 접근 가능
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { and, eq } from 'drizzle-orm';
import { ArrowLeft, FileText } from 'lucide-react';

import { withCompanyContext } from '@/db';
import { products } from '@/db/schema';
import { requireCompanyContext } from '@/lib/auth/session';
import { getPlanByProductId, type PlanSection } from '@/lib/products/plans';
import {
  buildDetailPagePrompt,
  type DetailPagePromptInput,
} from '@/lib/research/detail-page-prompt';

import { PlanForm } from './plan-form';

export const dynamic = 'force-dynamic';

interface PlanPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlanPage({ params }: PlanPageProps) {
  const { id } = await params;
  const ctx = await requireCompanyContext();

  // 상품 조회
  const product = await withCompanyContext(ctx.companyId, async (tx) => {
    const rows = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.company_id, ctx.companyId)))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!product) notFound();

  // 기존 기획서 조회
  const plan = await getPlanByProductId(ctx.companyId, id);

  // AI 프롬프트 미리 빌드 — 쿠팡 1페이지 데이터·리뷰 불만포인트 연결은 추후 작업
  const promptInput: DetailPagePromptInput = {
    productName: product.name,
    category: product.category,
    cnSourceUrl: product.cn_source_url,
    // 추후 링크 예정 — coupang_review_snapshots / research_review_analyses 에서 채움
    competitorTitles: [],
    complaints: [],
  };
  const aiPrompt = buildDetailPagePrompt(promptInput);

  const existingSections: PlanSection[] = Array.isArray(plan?.sections)
    ? (plan.sections as unknown as PlanSection[])
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 헤더 */}
      <header>
        <Link
          href={`/products/${id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-navy-500 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          상품 상세로
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-navy-900">
          <FileText className="h-6 w-6 text-teal-600" aria-hidden />
          상세페이지 기획서
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          <span className="font-semibold text-navy-700">{product.name}</span>
          <span className="ml-2 font-mono text-xs text-navy-400">{product.code}</span>
        </p>
        {plan && (
          <p className="mt-1 text-xs text-navy-400">
            마지막 수정: {formatDate(plan.updated_at)} · 상태: {CONFIDENCE_LABEL[plan.result_confidence] ?? plan.result_confidence}
          </p>
        )}
      </header>

      {/* AI 프롬프트 미리보기 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-900">🤖 AI 초안 프롬프트</h2>
          <p className="text-[11px] text-navy-500">
            Claude/ChatGPT/Gemini 등에 붙여넣으세요
          </p>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-blue-700 hover:text-blue-900">
            프롬프트 전체 보기 ({aiPrompt.length.toLocaleString('ko-KR')}자)
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-[11px] text-navy-800">
            {aiPrompt}
          </pre>
        </details>
        <p className="mt-2 text-[11px] text-navy-500">
          💡 현재는 쿠팡 1페이지 경쟁사 · 리뷰 불만포인트가 비어있습니다.
          추후 자동 연결 예정. 지금은 수동으로 프롬프트에 추가하세요.
        </p>
      </section>

      {/* 편집 폼 */}
      <PlanForm
        productId={id}
        initialHookSummary={plan?.hook_summary ?? ''}
        initialTargetAudience={plan?.target_audience ?? ''}
        initialNotes={plan?.notes ?? ''}
        initialSections={existingSections}
        initialConfidence={plan?.result_confidence ?? 'estimated'}
      />
    </div>
  );
}

const CONFIDENCE_LABEL: Record<string, string> = {
  estimated: '🟡 AI 초안',
  edited: '🔵 사용자 수정 중',
  confirmed: '🟢 최종 확정',
};

function formatDate(d: Date): string {
  try {
    return new Date(d).toLocaleDateString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}
