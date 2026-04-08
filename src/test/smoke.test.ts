/**
 * 스모크 테스트 — 가장 기본적인 작동 확인
 *
 * 역할:
 * - 모든 DB 스키마 모듈이 import 가능한지 확인
 * - 21개 표가 schema/index.ts에서 export 되는지 확인
 * - InfoHub zod 스키마가 정상 작동하는지 확인
 * - B-001 회귀 방지: 잘못된 필드명을 거부하는지 확인
 *
 * 이 테스트는 빌드 직전 마지막 안전장치 역할.
 * 새 표 추가 시 EXPECTED_TABLES 카운트도 함께 갱신해야 한다.
 */
import { describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';
import {
  BuywiseInfoHubArticleSchema,
  InfoHubCallError,
  InfoHubItemSchema,
  InfoHubSchemaError,
} from '@/lib/infohub/schema';

import type { ZodError } from 'zod';

// ─────────────────────────────────────────────────────────
// 1. DB 스키마 — 21개 표 export 확인
// ─────────────────────────────────────────────────────────
describe('db/schema — 21개 표 export', () => {
  const EXPECTED_TABLES = [
    // 그룹 A — 코어 (3)
    'companies',
    'users',
    'userCompanies',
    // 그룹 B — 파이프라인 (8)
    'suppliers',
    'keywords',
    'coupangReviewSnapshots',
    'products',
    'productStateHistory',
    'quotes',
    'purchaseOrders',
    'listings',
    // 그룹 C — 마케팅 (6)
    'adCampaigns',
    'adGroups',
    'adKeywords',
    'adMetrics',
    'seoTargets',
    'keywordRankings',
    // 그룹 D — 운영 (4)
    'tasks',
    'taskHistory',
    'tariffPresets',
    'notifications',
  ] as const;

  it('정확히 21개의 표가 정의되어야 한다', () => {
    expect(EXPECTED_TABLES.length).toBe(21);
  });

  it.each(EXPECTED_TABLES)('표 "%s"가 schema에서 export 되어야 한다', (tableName) => {
    expect(schema).toHaveProperty(tableName);
    expect(schema[tableName as keyof typeof schema]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────
// 2. InfoHub 스키마 — zod 검증 정상 작동
// ─────────────────────────────────────────────────────────
describe('lib/infohub/schema — zod 검증', () => {
  // InfoHubItemSchema의 모든 필수 필드를 채운 정상 응답
  const validInfoHubItem = {
    id: '11111111-1111-1111-1111-111111111111',
    source: 'youtube',
    source_url: 'https://example.com/article',
    title: '쿠팡 알고리즘 변경 공지',
    description: '쿠팡이 검색 알고리즘을 변경했습니다.',
    body_text: '본문 내용...',
    full_text: '전체 텍스트...',
    language: 'ko',
    collected_at: '2026-04-07T00:00:00+00:00',
    analyzed_at: null,
    created_at: '2026-04-07T00:00:00+00:00',
    published_at: '2026-04-07T00:00:00+00:00',
    relevance_score: 0.85,
    is_read: false,
    is_bookmarked: false,
    is_archived: false,
    is_duplicate: false,
    knowledge: null,
    user_id: '22222222-2222-2222-2222-222222222222',
    url_hash: 'abc123',
    author: '익명',
    author_url: 'https://example.com/user',
    thumbnail_url: 'https://example.com/thumb.jpg',
    metadata: {},
    notion_page_id: null,
    scrape_tier: null,
    content_length: null,
    analysis_schema: null,
    ai_analysis: null,
    fts_vector: '',
  };

  it('InfoHubItemSchema는 정상 데이터를 통과시킨다', () => {
    const result = InfoHubItemSchema.safeParse(validInfoHubItem);
    expect(result.success).toBe(true);
  });

  it('InfoHubItemSchema는 source_url을 url로 잘못 보낸 데이터를 거부한다 (B-001 회귀 방지)', () => {
    const invalid = { ...validInfoHubItem, source_url: undefined, url: 'https://example.com' };
    const result = InfoHubItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('InfoHubItemSchema는 description을 summary로 잘못 보낸 데이터를 거부한다 (B-001 회귀 방지)', () => {
    const invalid = { ...validInfoHubItem, description: undefined, summary: '요약' };
    const result = InfoHubItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  // BuywiseInfoHubArticleSchema 정상 데이터
  const validArticle = {
    company_id: '33333333-3333-3333-3333-333333333333',
    infohub_item_id: '44444444-4444-4444-4444-444444444444',
    source: 'infohub:youtube',
    source_url: 'https://example.com/article',
    title: '쿠팡 알고리즘 변경',
    description: '본문',
    knowledge_summary: null,
    category: null,
    tags: [],
    key_insights: null,
    action_items: null,
    confidence: 'estimated' as const,
    published_at: '2026-04-07T00:00:00+00:00',
    collected_at: '2026-04-07T00:00:00+00:00',
    fetched_at: '2026-04-07T00:00:00+00:00',
  };

  it('BuywiseInfoHubArticleSchema는 confidence가 estimated이면 통과시킨다', () => {
    const result = BuywiseInfoHubArticleSchema.safeParse(validArticle);
    expect(result.success).toBe(true);
  });

  it('BuywiseInfoHubArticleSchema는 confidence가 confirmed이면 거부한다 (ADR-007/011)', () => {
    const wrong = { ...validArticle, confidence: 'confirmed' };
    const result = BuywiseInfoHubArticleSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('BuywiseInfoHubArticleSchema는 confidence가 unknown이면 거부한다 (ADR-007/011)', () => {
    const wrong = { ...validArticle, confidence: 'unknown' };
    const result = BuywiseInfoHubArticleSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// 3. 커스텀 에러 클래스 — 정상 생성 확인
// ─────────────────────────────────────────────────────────
describe('InfoHub 커스텀 에러', () => {
  it('InfoHubSchemaError는 endpoint와 zodError를 보존한다', () => {
    const fakeZodError = { issues: [] } as unknown as ZodError;
    const err = new InfoHubSchemaError('잘못된 응답', '/items', fakeZodError);
    expect(err).toBeInstanceOf(Error);
    expect(err.endpoint).toBe('/items');
    expect(err.name).toBe('InfoHubSchemaError');
    expect(err.message).toContain('/items');
  });

  it('InfoHubCallError는 cause를 ES2022 표준대로 보존한다', () => {
    const original = new Error('네트워크 끊김');
    const err = new InfoHubCallError('호출 실패', '/collect', original);
    expect(err).toBeInstanceOf(Error);
    expect(err.endpoint).toBe('/collect');
    expect(err.cause).toBe(original);
  });

  it('InfoHubCallError는 cause 없이도 생성된다', () => {
    const err = new InfoHubCallError('타임아웃', '/search');
    expect(err).toBeInstanceOf(Error);
    expect(err.cause).toBeUndefined();
  });
});
