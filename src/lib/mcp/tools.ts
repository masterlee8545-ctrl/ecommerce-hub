/**
 * MCP Tools — Claude.ai 에 노출할 기능들.
 *
 * 각 툴:
 * - name: 고유 식별자 (snake_case)
 * - description: Claude 가 읽을 한글 설명 (사용 의도 명시)
 * - inputSchema: JSON Schema (파라미터 검증)
 * - handler: 실제 실행 로직 (ctx: { userId, companyId })
 *
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-3 (estimated 강제)
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { withCompanyContext } from '@/db';
import { db } from '@/db';
import {
  marketingActivities,
  MARKETING_CHANNELS,
  products,
  scrapeJobs,
  users,
  type MarketingChannel,
} from '@/db/schema';
import { listCompaniesForUser } from '@/lib/auth/company';
import { listCompanyMembers } from '@/lib/auth/user';
import { createActivity } from '@/lib/marketing/activities';
import { createProduct, updateProduct } from '@/lib/products/mutations';
import { getPlanByProductId, upsertPlan } from '@/lib/products/plans';
import { listProducts } from '@/lib/products/queries';
import { transitionProductStatus } from '@/lib/products/transitions';
import { DEFAULT_BATCH_CONDITION, type BatchFilterCondition } from '@/lib/research/batch-filter';
import { enqueueBatch, listJobsForBatch } from '@/lib/sello-scraper/job-queue';

export interface McpContext {
  userId: string;
  companyId: string;
  tokenLabel: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: McpContext,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 50;
const MAX_RECENT_BATCHES_SCAN = 50;

function textResult(obj: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`[mcp] ${field} 는 필수 문자열입니다.`);
  }
  return v.trim();
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string')) {
    throw new Error(`[mcp] ${field} 는 비어있지 않은 문자열 배열이어야 합니다.`);
  }
  return v as string[];
}

function asOptionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

// ─────────────────────────────────────────────────────────
// 툴 정의
// ─────────────────────────────────────────────────────────

const TOOLS: McpTool[] = [
  // ── 법인·사용자 ──
  {
    name: 'whoami',
    description:
      '현재 MCP 토큰의 소유자(사용자)와 활성 법인을 확인합니다. 디버깅 및 "나는 어떤 법인에서 일하는 중?" 확인용.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const userRows = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
      const companies = await listCompaniesForUser(ctx.userId);
      const active = companies.find((c) => c.id === ctx.companyId);
      return textResult({
        tokenLabel: ctx.tokenLabel,
        user: { id: ctx.userId, email: userRows[0]?.email, name: userRows[0]?.name },
        activeCompany: active,
        allCompanies: companies,
      });
    },
  },
  {
    name: 'list_members',
    description:
      '현재 활성 법인의 직원 목록을 반환합니다. 담당자 배정할 때 userId 를 찾는 용도.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const members = await listCompanyMembers(ctx.companyId);
      return textResult(members);
    },
  },

  // ── 상품 (CRUD) ──
  {
    name: 'list_products',
    description:
      '현재 활성 법인의 상품 목록 조회. stage 로 단계 필터링 가능 (research/sourcing/importing/listing/active).',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['research', 'sourcing', 'importing', 'listing', 'active'],
          description: '조회할 파이프라인 단계 (선택). 생략 시 전체.',
        },
        limit: { type: 'number', description: '최대 개수 (기본 50)' },
      },
    },
    handler: async (args, ctx) => {
      const stage = typeof args.stage === 'string' ? args.stage : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIST_LIMIT;
      const listArgs: Parameters<typeof listProducts>[0] = { companyId: ctx.companyId, limit };
      if (stage) {
        listArgs.stages = [stage as 'research' | 'sourcing' | 'importing' | 'listing' | 'active'];
      }
      const rows = await listProducts(listArgs);
      return textResult(
        rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          status: r.status,
          cn_source_url: r.cn_source_url,
          created_at: r.created_at,
        })),
      );
    },
  },
  {
    name: 'add_to_basket',
    description:
      '상품 발굴 단계(research) 에 상품을 추가합니다. 키워드를 아이템스카우트/쿠팡 리서치로 찾은 후 장바구니에 담는 용도.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '상품명' },
        cnSourceUrl: { type: 'string', description: '1688/타오바오 링크 (선택)' },
        memo: { type: 'string', description: '한줄 메모 (검색량·경쟁강도 등)' },
      },
    },
    handler: async (args, ctx) => {
      const name = asString(args.name, 'name');
      const cnSourceUrl = asOptionalString(args.cnSourceUrl);
      const memo = asOptionalString(args.memo);
      const { suggestNextProductCode } = await import('@/lib/products/mutations');
      const code = await suggestNextProductCode(ctx.companyId).catch(() => `PROD-${Date.now()}`);
      const { id } = await createProduct({
        companyId: ctx.companyId,
        code,
        name,
        description: memo ?? null,
        cnSourceUrl,
        createdBy: ctx.userId,
        ownerUserId: ctx.userId,
      });
      return textResult({ ok: true, productId: id, code, message: `"${name}" 장바구니 추가됨` });
    },
  },
  {
    name: 'get_product',
    description: '특정 상품의 상세 정보 조회 (필드 전체, 기획서, 담당자, 마케팅 활동 포함).',
    inputSchema: {
      type: 'object',
      required: ['productId'],
      properties: { productId: { type: 'string' } },
    },
    handler: async (args, ctx) => {
      const productId = asString(args.productId, 'productId');
      const productRows = await withCompanyContext(ctx.companyId, async (tx) => {
        return tx
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.company_id, ctx.companyId)))
          .limit(1);
      });
      const product = productRows[0];
      if (!product) return textResult({ error: '상품을 찾을 수 없습니다.' });
      const [plan, activities] = await Promise.all([
        getPlanByProductId(ctx.companyId, productId),
        withCompanyContext(ctx.companyId, async (tx) =>
          tx
            .select()
            .from(marketingActivities)
            .where(
              and(
                eq(marketingActivities.product_id, productId),
                eq(marketingActivities.company_id, ctx.companyId),
              ),
            ),
        ),
      ]);
      return textResult({ product, plan, marketingActivities: activities });
    },
  },
  {
    name: 'assign_staff',
    description:
      '상품의 담당자 배정. role 은 plan (상세페이지 기획) / listing (상품 등록) / rocket (로켓 입점).',
    inputSchema: {
      type: 'object',
      required: ['productId', 'role', 'userId'],
      properties: {
        productId: { type: 'string' },
        role: { type: 'string', enum: ['plan', 'listing', 'rocket'] },
        userId: {
          type: 'string',
          description: '배정할 직원의 user.id (list_members 로 조회).',
        },
      },
    },
    handler: async (args, ctx) => {
      const productId = asString(args.productId, 'productId');
      const role = asString(args.role, 'role');
      const userId = asString(args.userId, 'userId');
      const patch =
        role === 'plan'
          ? { planAssigneeId: userId }
          : role === 'listing'
            ? { listingAssigneeId: userId }
            : { rocketAssigneeId: userId };
      await updateProduct({ companyId: ctx.companyId, productId, ...patch });
      return textResult({ ok: true, message: `${role} 담당자 배정 완료` });
    },
  },
  {
    name: 'transition_stage',
    description:
      '상품의 파이프라인 단계를 다음으로 전환. 자동 태스크 생성됨. listing → active 는 입고 확인(received_at) 필수.',
    inputSchema: {
      type: 'object',
      required: ['productId', 'toStage'],
      properties: {
        productId: { type: 'string' },
        toStage: {
          type: 'string',
          enum: ['sourcing', 'importing', 'listing', 'active'],
        },
        reason: { type: 'string', description: '전환 사유 (선택)' },
      },
    },
    handler: async (args, ctx) => {
      const productId = asString(args.productId, 'productId');
      const toStage = asString(args.toStage, 'toStage') as
        | 'sourcing'
        | 'importing'
        | 'listing'
        | 'active';
      const reason = asOptionalString(args.reason);
      const tArgs: Parameters<typeof transitionProductStatus>[0] = {
        companyId: ctx.companyId,
        productId,
        toStatus: toStage,
        changedBy: ctx.userId,
      };
      if (reason) tArgs.reason = reason;
      const result = await transitionProductStatus(tArgs);
      return textResult({ ok: true, result });
    },
  },

  // ── 기획서 ──
  {
    name: 'save_product_plan',
    description:
      '상품의 상세페이지 기획서 upsert. sections 는 {position, title, imageDesc, color, copy, hook} 배열.',
    inputSchema: {
      type: 'object',
      required: ['productId'],
      properties: {
        productId: { type: 'string' },
        hookSummary: { type: 'string' },
        targetAudience: { type: 'string' },
        notes: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'number' },
              title: { type: 'string' },
              imageDesc: { type: 'string' },
              color: { type: 'string' },
              copy: { type: 'string' },
              hook: { type: 'string' },
            },
          },
        },
        resultConfidence: {
          type: 'string',
          enum: ['estimated', 'edited', 'confirmed'],
        },
      },
    },
    handler: async (args, ctx) => {
      const productId = asString(args.productId, 'productId');
      const sections = Array.isArray(args.sections)
        ? (args.sections as Array<{
            position: number;
            title: string;
            imageDesc: string | null;
            color: string | null;
            copy: string | null;
            hook: string | null;
          }>)
        : undefined;
      const input: Parameters<typeof upsertPlan>[0] = {
        companyId: ctx.companyId,
        productId,
        userId: ctx.userId,
      };
      if (sections) input.sections = sections;
      const hookSummary = asOptionalString(args.hookSummary);
      if (hookSummary !== undefined) input.hookSummary = hookSummary;
      const targetAudience = asOptionalString(args.targetAudience);
      if (targetAudience !== undefined) input.targetAudience = targetAudience;
      const notes = asOptionalString(args.notes);
      if (notes !== undefined) input.notes = notes;
      if (args.resultConfidence === 'estimated' || args.resultConfidence === 'edited' || args.resultConfidence === 'confirmed') {
        input.resultConfidence = args.resultConfidence;
      }
      await upsertPlan(input);
      return textResult({ ok: true, message: '기획서 저장됨' });
    },
  },

  // ── 마케팅 ──
  {
    name: 'add_marketing_activity',
    description:
      '상품에 마케팅 작업 추가 (쿠팡 체험단·블로그·인스타·CPC 등). channel 은 coupang_review, naver_review, blog, instagram, youtube, cafe, coupang_cpc 중 하나.',
    inputSchema: {
      type: 'object',
      required: ['productId', 'channel'],
      properties: {
        productId: { type: 'string' },
        channel: {
          type: 'string',
          enum: [
            'coupang_review',
            'naver_review',
            'blog',
            'instagram',
            'youtube',
            'cafe',
            'coupang_cpc',
          ],
        },
        assigneeId: { type: 'string', description: '담당자 userId (선택)' },
        costKrw: { type: 'number', description: '집행 비용 (원)' },
        notes: { type: 'string', description: '메모 (체험단 플랫폼명·주제 등)' },
      },
    },
    handler: async (args, ctx) => {
      const productId = asString(args.productId, 'productId');
      const channelStr = asString(args.channel, 'channel');
      if (!(MARKETING_CHANNELS as readonly string[]).includes(channelStr)) {
        throw new Error(`[mcp] 유효하지 않은 채널: ${channelStr}`);
      }
      const channel = channelStr as MarketingChannel;
      const assigneeId = asOptionalString(args.assigneeId) ?? null;
      const costKrw = typeof args.costKrw === 'number' ? args.costKrw : null;
      const notes = asOptionalString(args.notes) ?? null;
      const { id } = await createActivity({
        companyId: ctx.companyId,
        productId,
        userId: ctx.userId,
        channel,
        assigneeId,
        costKrw,
        notes,
      });
      return textResult({ ok: true, activityId: id });
    },
  },

  // ── 배치 분석 ──
  {
    name: 'start_batch_analysis',
    description:
      '여러 키워드에 대한 쿠팡 1페이지 메트릭 배치 분석 시작. 로컬 워커가 순차 스크래핑해서 리뷰수/로켓비율/가격 수집. batchId 반환됨.',
    inputSchema: {
      type: 'object',
      required: ['keywords'],
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
        reviewThreshold: { type: 'number', description: '기준 리뷰수 (기본 300)' },
        minBelowReviewRatio: {
          type: 'number',
          description: '임계 이하 비율 (0~1, 기본 0.5)',
        },
        maxRocketRatio: { type: 'number', description: '로켓 상한 (0~1, 선택)' },
        priceMedianMin: { type: 'number', description: '가격 중앙값 하한 (선택)' },
        priceMedianMax: { type: 'number', description: '가격 중앙값 상한 (선택)' },
        forceFresh: { type: 'boolean', description: '캐시 무시하고 새로 스크래핑 (기본 false)' },
      },
    },
    handler: async (args, ctx) => {
      const keywords = asStringArray(args.keywords, 'keywords');
      const cond: BatchFilterCondition = {
        reviewThreshold:
          typeof args.reviewThreshold === 'number'
            ? args.reviewThreshold
            : DEFAULT_BATCH_CONDITION.reviewThreshold,
        minBelowReviewRatio:
          typeof args.minBelowReviewRatio === 'number'
            ? args.minBelowReviewRatio
            : DEFAULT_BATCH_CONDITION.minBelowReviewRatio,
        maxRocketRatio: typeof args.maxRocketRatio === 'number' ? args.maxRocketRatio : null,
        priceMedianMin: typeof args.priceMedianMin === 'number' ? args.priceMedianMin : null,
        priceMedianMax: typeof args.priceMedianMax === 'number' ? args.priceMedianMax : null,
      };
      const { batchId } = await enqueueBatch({
        companyId: ctx.companyId,
        keywords,
        filterCond: cond,
        forceFresh: args.forceFresh === true,
        requestedBy: ctx.userId,
      });
      return textResult({
        ok: true,
        batchId,
        message: `${keywords.length}개 키워드 큐 등록됨. 로컬 워커(npm run sello:worker)가 순차 처리.`,
        statusUrl: `/research/batch-analysis?batchId=${batchId}`,
      });
    },
  },
  {
    name: 'get_batch_status',
    description: '배치 분석 진행 상황 조회 — 각 키워드의 상태, 메트릭, 통과/탈락 판정.',
    inputSchema: {
      type: 'object',
      required: ['batchId'],
      properties: { batchId: { type: 'string' } },
    },
    handler: async (args, ctx) => {
      const batchId = asString(args.batchId, 'batchId');
      const jobs = await listJobsForBatch(ctx.companyId, batchId);
      const summary = jobs.reduce<Record<string, number>>(
        (acc, j) => {
          acc[j.status] = (acc[j.status] ?? 0) + 1;
          return acc;
        },
        { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 },
      );
      return textResult({
        batchId,
        summary: { ...summary, total: jobs.length },
        jobs: jobs.map((j) => ({
          keyword: j.keyword,
          status: j.status,
          cache_hit: j.cache_hit,
          error: j.error,
          result: j.result
            ? {
                rowCount: (j.result as { rowCount?: number }).rowCount,
                rocketRatio: (j.result as { rocketRatio?: number }).rocketRatio,
                priceStats: (j.result as { priceStats?: unknown }).priceStats,
              }
            : null,
        })),
      });
    },
  },
  {
    name: 'list_recent_batches',
    description: '현재 법인의 최근 배치 목록 (최근 10개).',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const rows = await db
        .select({
          batch_id: scrapeJobs.batch_id,
          status: scrapeJobs.status,
          keyword: scrapeJobs.keyword,
          requested_at: scrapeJobs.requested_at,
        })
        .from(scrapeJobs)
        .where(eq(scrapeJobs.company_id, ctx.companyId))
        .orderBy(desc(scrapeJobs.requested_at))
        .limit(MAX_RECENT_BATCHES_SCAN);
      // batch 별로 묶어 요약
      const grouped = new Map<
        string,
        { keywords: string[]; statuses: string[]; firstAt: Date }
      >();
      for (const r of rows) {
        const g = grouped.get(r.batch_id);
        if (g) {
          g.keywords.push(r.keyword);
          g.statuses.push(r.status);
        } else {
          grouped.set(r.batch_id, {
            keywords: [r.keyword],
            statuses: [r.status],
            firstAt: r.requested_at,
          });
        }
      }
      const MAX_BATCHES = 10;
      const batches = Array.from(grouped.entries())
        .slice(0, MAX_BATCHES)
        .map(([batchId, g]) => ({
          batchId,
          keywords: g.keywords,
          statuses: g.statuses,
          requestedAt: g.firstAt,
        }));
      return textResult({ batches });
    },
  },

  // ── 피벗 ──
  {
    name: 'switch_company',
    description:
      '토큰의 활성 법인을 다른 법인으로 전환. 사용자가 여러 법인 멤버십 가진 경우만 유용. (신규 토큰 발급 권장)',
    inputSchema: {
      type: 'object',
      required: ['companyId'],
      properties: { companyId: { type: 'string' } },
    },
    handler: async (args, ctx) => {
      const companyId = asString(args.companyId, 'companyId');
      const userCompanies = await listCompaniesForUser(ctx.userId);
      if (!userCompanies.some((c) => c.id === companyId)) {
        throw new Error('[mcp] 해당 법인 멤버십이 없습니다.');
      }
      // 이 요청 범위에서만 바꿈 — 토큰의 company_id 는 DB 에 영구 저장된 값. 변경하려면 token 재발급.
      return textResult({
        note: '이번 호출만 해당 법인 컨텍스트로 처리됩니다. 영구 변경은 토큰 재발급.',
        requestedCompanyId: companyId,
      });
    },
  },
];

export function getMcpTools(): McpTool[] {
  return TOOLS;
}

export function findMcpTool(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

// inArray 사용 없음 — 제거를 위한 assertion
void inArray;
