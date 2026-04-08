/**
 * InfoHub MCP 응답 스키마 (Brother Project Contract)
 *
 * 출처: docs/INFOHUB_INTEGRATION.md §4.8 (D-002 실호출 검증 완료, 2026-04-07)
 * 관련 헌법: CLAUDE.md §1 P-8 (형제 프로젝트 응답 스키마 가정 금지), §8 형제 프로젝트 계약
 * 관련 ADR: ADR-011 (InfoHub 형제 프로젝트 통합)
 * 관련 버그: agents/bugs.md B-001 (스키마 가정 불일치 사건 — 본 파일이 그 시정 결과)
 *
 * ⚠ 사용 규칙:
 * 1. InfoHub MCP 응답은 사용 전 반드시 `parse()`로 zod 검증 (M-009 방지)
 * 2. 모든 결과는 `confidence: 'estimated'` (🟡) 마킹 강제 (ADR-007 + ADR-011)
 * 3. 6시간 경과 캐시는 `confidence: 'unknown'` (❓)으로 다운그레이드 (M-011 방지)
 * 4. 응답 스키마가 본 파일과 다르면 즉시 작업 중단 + bugs.md 기록 (P-5/P-8 위반)
 *
 * ⚠ 자주 틀리는 필드 이름 (B-001 사례):
 * - ❌ summary  → ✅ description (또는 body_text / full_text / knowledge.knowledge_summary)
 * - ❌ url      → ✅ source_url
 * - ❌ knowledge_card → ✅ knowledge
 * - 응답 wrapper: 단순 배열이 아니라 { items, total, offset, limit, facets }
 */
import { z } from 'zod';

// ============================================================
// InfoHub 지식 카드 (knowledge 객체)
// ============================================================

const KeyInsightSchema = z.object({
  insight: z.string(),
  detail: z.string(),
  actionable: z.boolean(),
});

export const InfoHubKnowledgeSchema = z
  .object({
    tags: z.array(z.string()),
    category: z.string(),
    priority: z.string(),
    knowledge_summary: z.string(),
    key_insights: z.array(KeyInsightSchema),
    action_items: z.array(z.string()),
    methods_and_tips: z.array(z.unknown()),
    key_quotes: z.array(z.unknown()),
    discoveries: z.array(z.unknown()),
    relevance_score: z.number(),
  })
  .nullable();

// ============================================================
// InfoHub 아이템 (search/knowledge 응답의 items[] 요소)
// ============================================================

export const InfoHubItemSchema = z.object({
  // 핵심 식별자
  id: z.string().uuid(),
  source: z.string(),
  source_url: z.string().url(), //          ⚠ url 아님 (B-001)
  title: z.string(),

  // 본문 (요약/원문 4중 분리)
  description: z.string(), //               ⚠ summary 아님 (B-001)
  body_text: z.string(),
  full_text: z.string(),
  language: z.string(),

  // 시간
  collected_at: z.string().datetime({ offset: true }),
  analyzed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  published_at: z.string().datetime({ offset: true }),

  // 점수/플래그
  relevance_score: z.number(),
  is_read: z.boolean(),
  is_bookmarked: z.boolean(),
  is_archived: z.boolean(),
  is_duplicate: z.boolean(),

  // 지식 카드 (AI 분석 결과)
  knowledge: InfoHubKnowledgeSchema, //     ⚠ knowledge_card 아님 (B-001)

  // 받기만 하는 필드 (사용자 노출 X, 구조 검증만)
  user_id: z.string().uuid(),
  url_hash: z.string(),
  author: z.string(),
  author_url: z.string(),
  thumbnail_url: z.string(),
  metadata: z.record(z.unknown()),
  notion_page_id: z.string().nullable(),
  scrape_tier: z.string().nullable(),
  content_length: z.number().nullable(),
  analysis_schema: z.string().nullable(),
  ai_analysis: z.unknown().nullable(),
  fts_vector: z.string(),
});

// ============================================================
// InfoHub search/knowledge 응답 wrapper
// ============================================================

export const InfoHubSearchResponseSchema = z.object({
  items: z.array(InfoHubItemSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  facets: z
    .object({
      sources: z.record(z.number()),
      categories: z.record(z.number()),
      priorities: z.record(z.number()),
      tags: z.record(z.number()),
    })
    .optional(),
});

// ============================================================
// InfoHub collect 응답 (단순 wrapper)
// ============================================================

export const InfoHubCollectResultSchema = z.object({
  source: z.string(),
  found: z.number(),
  new_items: z.number(),
  duplicates: z.number(),
});

export const InfoHubCollectResponseSchema = z.object({
  success: z.boolean(),
  keyword: z.string(),
  english_keyword: z.string().optional(),
  results: z.array(InfoHubCollectResultSchema),
  total_new: z.number(),
});

// ============================================================
// InfoHub topic 응답 (infohub_topics)
// ============================================================

export const InfoHubTopicKeywordSchema = z.object({
  id: z.string().uuid(),
  topic_id: z.string().uuid(),
  keyword: z.string(),
  is_active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
});

export const InfoHubTopicSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  ia_topic_keywords: z.array(InfoHubTopicKeywordSchema),
  unread_count: z.number().optional(),
});

// ============================================================
// 우리 시스템 내부 표현 (BUYWISE 도메인 변환 후)
// ============================================================

/**
 * InfoHub에서 가져온 정보를 우리 시스템에 저장할 때 사용.
 * - 항상 `confidence: 'estimated'` 강제 (ADR-007 + ADR-011)
 * - `source: 'infohub:*'` 출처 명시 강제
 * - `fetched_at` 기록 강제 (6시간 TTL)
 */
export const BuywiseInfoHubArticleSchema = z.object({
  // 우리 회사 ID (멀티테넌트 P-5)
  company_id: z.string().uuid(),

  // InfoHub 원본 식별자
  infohub_item_id: z.string().uuid(),
  source: z.string(), //         예: 'infohub:youtube'
  source_url: z.string().url(),

  // 본문
  title: z.string(),
  description: z.string(),
  knowledge_summary: z.string().nullable(),

  // 분류
  category: z.string().nullable(),
  tags: z.array(z.string()),

  // AI 인사이트
  key_insights: z.array(KeyInsightSchema).nullable(),
  action_items: z.array(z.string()).nullable(),

  // 신뢰도 (강제 estimated, ADR-007)
  confidence: z.literal('estimated'),

  // 시간
  published_at: z.string().datetime({ offset: true }),
  collected_at: z.string().datetime({ offset: true }),
  fetched_at: z.string().datetime({ offset: true }), //  우리가 InfoHub 호출한 시각 (6h TTL 기준)
});

// ============================================================
// 타입 추론 export
// ============================================================

export type InfoHubKnowledge = z.infer<typeof InfoHubKnowledgeSchema>;
export type InfoHubItem = z.infer<typeof InfoHubItemSchema>;
export type InfoHubSearchResponse = z.infer<typeof InfoHubSearchResponseSchema>;
export type InfoHubCollectResponse = z.infer<typeof InfoHubCollectResponseSchema>;
export type InfoHubTopic = z.infer<typeof InfoHubTopicSchema>;
export type BuywiseInfoHubArticle = z.infer<typeof BuywiseInfoHubArticleSchema>;

// ============================================================
// Custom Error
// ============================================================

/**
 * InfoHub 응답이 본 스키마와 일치하지 않을 때 throw.
 * 발견 시 즉시 작업 중단 + agents/bugs.md 에 새 B-NNN (예: B-001) 항목 기록.
 */
export class InfoHubSchemaError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
    public readonly zodError: z.ZodError,
  ) {
    super(`[InfoHubSchemaError] ${endpoint}: ${message}`);
    this.name = 'InfoHubSchemaError';
  }
}

/**
 * InfoHub 호출이 네트워크/HTTP/타임아웃 등으로 실패했을 때 throw.
 * P-1 (빈 결과 은폐 금지) 방지: try-catch로 빈 배열 반환 금지.
 *
 * 주의: ES2022 Error는 표준 `cause` 필드를 가진다 (lib.es2022.error.d.ts).
 * 우리는 명시적으로 노출하기 위해 override + super(message, { cause }) 패턴을 사용한다.
 */
export class InfoHubCallError extends Error {
  public readonly endpoint: string;

  constructor(message: string, endpoint: string, cause?: unknown) {
    super(`[InfoHubCallError] ${endpoint}: ${message}`, cause !== undefined ? { cause } : undefined);
    this.name = 'InfoHubCallError';
    this.endpoint = endpoint;
  }
}
