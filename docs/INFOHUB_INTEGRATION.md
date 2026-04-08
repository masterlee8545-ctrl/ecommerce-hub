# InfoHub 통합 가이드

> 이 문서는 ecommerce-hub가 형제 프로젝트 **InfoHub**(`C:/개발/정보취합-2/`)의 MCP 서버를 어떻게 사용하는지 정의한다.
> 모든 InfoHub 호출은 이 가이드를 따라야 한다.
> ADR-011의 운영 매뉴얼이며, 변경 시 ADR-011도 함께 갱신한다.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 관련 ADR | ADR-006 (BW Rank 프록시), ADR-007 (확신도 마킹), ADR-011 (InfoHub 계약) |
| 관련 헌법 | CLAUDE.md §1 P-1, P-2, P-3 |
| InfoHub 측 헌법 | `C:/개발/정보취합-2/CLAUDE.md` §P-5 (MCP 응답 스키마 무단 변경 금지) |

---

## 1. InfoHub란?

InfoHub(`정보취합-2`)는 28개 외부 소스에서 정보를 수집·AI 분석·큐레이션하는 **인프라 프로젝트**다.

### 1.1 InfoHub의 자체 정의 (출처: `C:/개발/정보취합-2/CLAUDE.md`)
> "InfoHub는 인프라다. 4개 형제 프로젝트가 MCP를 통해 InfoHub의 지식을 읽는다.
> InfoHub의 응답 스키마가 바뀌면 형제 프로젝트가 깨진다."

ecommerce-hub는 그 형제 프로젝트 중 하나다.

### 1.2 지원 소스 (28개)
| 그룹 | 소스 |
|---|---|
| 영상 | youtube |
| 한국 블로그/뉴스 | naver_blog, naver_news, naver_cafe, velog, naver-d2, kakao-tech, yozm-it, neuron, okky |
| 검색 | google, perplexity |
| 글로벌 기술 | hackernews, arxiv, github, hashnode, stackoverflow, devto, geeknews, lobsters, huggingface, medium, tldr, superhuman |
| 제품/디자인 | producthunt |
| 인사이트 | blackhatworld (마케팅 노하우) |
| 소셜 | instagram |
| 일반 | rss |

### 1.3 InfoHub 인프라 정보
- **앱 URL**: `https://infohub-app-bwzkr.vercel.app` (출처: `mcp-server/index.ts:10` ✅)
- **인증**: Supabase JWT (Service Role Key 기반 자동 갱신)
- **MCP 서버 위치**: `C:/개발/정보취합-2/mcp-server/index.ts`
- **MCP 서버 버전**: 1.1.0 (출처: `mcp-server/index.ts:249` ✅)
- **DB 테이블 접두사**: `ia_` (InfoHub 측 ADR-001)

---

## 2. MCP 도구 6개 — 시그니처

> 아래 시그니처는 `C:/개발/정보취합-2/mcp-server/index.ts`에서 직접 읽어서 추출한 ✅ 확정값이다 (2026-04-07 시점).

### 2.1 `infohub_topics` — 토픽 목록
```typescript
infohub_topics()  // 파라미터 없음
```
**반환**: InfoHub의 모든 토픽(프로젝트) + 키워드 + 미읽음 카운트

### 2.2 `infohub_collect` — 외부 소스 수집
```typescript
infohub_collect({
  keyword: string,                    // 검색 키워드 (한/영, 자동 번역됨)
  sources: string[],                  // 1개 이상, ALL_SOURCES 중에서
  topicId?: string,                   // (선택) 토픽 UUID
  autoAnalyze?: boolean,              // 기본 true (수집 후 즉시 AI 분석)
})
```
**타임아웃**: 120초 (`mcp-server/index.ts:95` ✅)

### 2.3 `infohub_search` — 수집된 아이템 검색
```typescript
infohub_search({
  query: string,                                    // 필수
  topicId?: string,
  source?: string,                                  // 단일 소스 필터
  limit?: number,                                   // 1~100, 기본 20
  knowledgeOnly?: boolean,                          // 분석된 것만, 기본 false
  sort?: 'collected_at' | 'relevance_score',        // 기본 'relevance_score'
})
```

### 2.4 `infohub_knowledge` — AI 지식 카드
```typescript
infohub_knowledge({
  query: string,
  topicId?: string,
  limit?: number,                     // 1~50, 기본 5
})
```
**내부 동작**: `infohub_search`에 `knowledgeOnly=true`를 강제한 wrapper

### 2.5 `infohub_analyze` — 미분석 아이템 AI 분석
```typescript
infohub_analyze({
  topicId?: string,
  batchSize?: number,                 // 1~50, 기본 10
  retry?: boolean,                    // 실패한 것 재분석, 기본 false
  forceReanalyze?: boolean,           // 전체 재분석, 기본 false
})
```

### 2.6 `infohub_export` — 내보내기
```typescript
infohub_export({
  topicId?: string,
  format?: 'markdown' | 'csv' | 'json',  // 기본 'json'
})
```

---

## 3. BUYWISE 6단계 파이프라인 × InfoHub 활용 시나리오

### 3.1 Research 단계 (키워드 발굴)

**시나리오**: 사용자가 "나노 세라믹 코팅" 키워드를 후보로 등록할 때, 시장 트렌드와 소비자 관심도를 함께 보여준다.

#### Step 1: 신선한 데이터 수집
```typescript
mcp__infohub__infohub_collect({
  keyword: "나노 세라믹 코팅",
  sources: ["naver_blog", "naver_news", "youtube"],  // 한국 시장 → 한국 소스 우선
  autoAnalyze: true,
});
```

#### Step 2: 분석된 지식 카드 조회
```typescript
mcp__infohub__infohub_knowledge({
  query: "나노 세라믹 코팅 트렌드",
  limit: 5,
});
```

#### Step 3: BUYWISE 키워드 점수에 가중치
- InfoHub에서 "최근 30일 멘션 수" 추출 → BUYWISE 키워드 점수 보조 지표 (🟡 estimated)
- 점수 가중치는 사용자 확정 전까지 자동 적용 금지

### 3.2 Sourcing 단계 (공급사 평판 조사)

**시나리오**: 1688에서 후보 공급사 발견 후, 평판/사기 이력을 InfoHub로 검증.

```typescript
// blackhatworld는 사기/스캠 정보가 자주 올라옴
mcp__infohub__infohub_collect({
  keyword: "LongRich Manufacturer scam OR review",
  sources: ["google", "perplexity", "blackhatworld"],
  autoAnalyze: true,
});

mcp__infohub__infohub_search({
  query: "LongRich review",
  source: "perplexity",
  limit: 10,
  sort: "relevance_score",
});
```

**결과 활용**: `suppliers.reputation_notes` 필드에 InfoHub 결과 요약 저장 + `reputation_confidence: 'estimated'` (🟡)

### 3.3 Listing 단계 (상품명/이미지)

**시나리오**: 쿠팡 상품명 작성 시 SEO 노하우 참고.

```typescript
mcp__infohub__infohub_knowledge({
  query: "쿠팡 상품명 SEO 키워드 최적화",
  limit: 10,
});
```

**결과 활용**: 상품명 작성 가이드라인 (🟡 추정 — 검증 안 된 노하우임을 명시)

### 3.4 Marketing 단계 (광고/SEO)

**시나리오**: 광고 ROAS 떨어졌을 때, 최신 운영 노하우 검색.

```typescript
mcp__infohub__infohub_collect({
  keyword: "쿠팡 광고 ROAS 개선 2026",
  sources: ["youtube", "naver_blog", "blackhatworld"],
  autoAnalyze: true,
});

// 며칠 뒤 분석된 결과 조회
mcp__infohub__infohub_knowledge({
  query: "쿠팡 광고 ROAS 개선",
  limit: 5,
});
```

### 3.5 Branding 단계 (자사 브랜드 멘션)

**시나리오**: "유어밸류" 브랜드가 외부에서 어떻게 언급되는지 모니터링.

```typescript
mcp__infohub__infohub_collect({
  keyword: "유어밸류 농산물",
  sources: ["naver_blog", "naver_news", "naver_cafe", "youtube", "instagram"],
  autoAnalyze: true,
});
```

**결과 활용**: Branding 대시보드의 "이번 주 멘션 수" 카드 (🟡)

---

## 4. 의존 필드 목록 (Brother Project Contract)

> 이 섹션은 ecommerce-hub가 InfoHub 응답에서 사용하는 필드 목록이다.
> InfoHub 측에서 이 필드를 변경/삭제하면 우리가 깨진다.
> ecommerce-hub 빌드 직후 이 목록을 InfoHub 팀에 공유한다.

> **검증 상태**: 2026-04-07 실 호출로 ✅ confirmed (D-002 작업, `agents/bugs.md` B-001 참조)
> 첫 호출 결과 우리 가정과 큰 차이 발견 → 이 섹션 대대적 갱신됨.

### 4.1 응답 wrapper 구조 (`{ items, total, offset, limit, facets }`) ✅

`infohub_search`와 `infohub_knowledge` 모두 **동일한 wrapper**를 반환한다 (knowledge는 `knowledgeOnly=true` 강제 wrapper).

| 필드 | 타입 | 의미 | 필수 |
|---|---|---|---|
| `items` ✅ | array | 결과 아이템 배열 | 필수 |
| `total` ✅ | number | 전체 매칭 건수 (페이지네이션용) | 필수 |
| `offset` ✅ | number | 현재 페이지 시작 인덱스 | 필수 |
| `limit` ✅ | number | 페이지 크기 | 필수 |
| `facets` ✅ | object | 집계 정보 (sources/categories/priorities/tags 카운트) | 선택 |

### 4.2 `items[]` 필드 (실제 응답 기준 ✅)

> 출처: 2026-04-07 `infohub_search({ query: "나노 세라믹 코팅", source: "naver_blog", limit: 3 })` 실 호출 결과 ✅

#### 4.2.1 핵심 필드 (필수, 우리가 의존)
| 필드 | 타입 | 사용 위치 | 비고 |
|---|---|---|---|
| `id` ✅ | string (UUID) | 캐시 키, DB FK | |
| `title` ✅ | string | UI 표시 | |
| `description` ✅ | string | UI 짧은 요약 | ⚠ 우리 가정 `summary` 아님 |
| `body_text` ✅ | string | UI 본문 발췌 | description과 거의 동일 |
| `full_text` ✅ | string \| `""` | 전체 본문 (스크래핑 완료 시) | scrape_tier에 따라 빈 문자열 가능 |
| `source` ✅ | string (enum) | 출처 표시 + 필터 | `naver_blog` 등 28개 |
| `source_url` ✅ | string (URL) | "원문 보기" 링크 | ⚠ 우리 가정 `url` 아님 |
| `collected_at` ✅ | string (ISO+TZ) | 신선도 계산 (TTL 6시간) | `2026-04-07T05:01:41.354+00:00` |
| `analyzed_at` ✅ | string (ISO+TZ) \| null | AI 분석 시점 | null이면 미분석 |
| `created_at` ✅ | string (ISO+TZ) | DB 레코드 생성 시점 | |
| `published_at` ✅ | string (ISO+TZ) | 원본 게시 시점 | |
| `language` ✅ | string (enum) | 언어 코드 (`ko`/`en`/...) | |
| `relevance_score` ✅ | number (0~100) | 정렬 + 가중치 | top-level 위치 |

#### 4.2.2 메타데이터 필드 (선택, UI 보조)
| 필드 | 타입 | 사용 위치 |
|---|---|---|
| `user_id` ✅ | string (UUID) | (InfoHub 내부, 우리는 무시) |
| `url_hash` ✅ | string | (InfoHub 내부 dedupe, 우리는 무시) |
| `author` ✅ | string | "작성자" 표시 |
| `author_url` ✅ | string | 작성자 프로필 링크 |
| `thumbnail_url` ✅ | string \| `""` | 썸네일 이미지 |
| `metadata` ✅ | object | 소스별 추가 데이터 (`{cafename, originallink}` 등) |
| `is_read` ✅ | boolean | 읽음 상태 |
| `is_bookmarked` ✅ | boolean | 북마크 상태 |
| `is_archived` ✅ | boolean | 아카이브 상태 |
| `is_duplicate` ✅ | boolean | 중복 감지 플래그 |
| `notion_page_id` ✅ | string \| null | Notion 통합 페이지 ID |
| `scrape_tier` ✅ | string \| null | 스크래핑 단계 (`body_text` 등) |
| `content_length` ✅ | number \| null | 본문 글자 수 |
| `analysis_schema` ✅ | string \| null | AI 분석 스키마 종류 (`general` 등) |
| `ai_analysis` ✅ | unknown \| null | (legacy 필드, 우리는 무시) |
| `fts_vector` ✅ | string | (PostgreSQL FTS 내부, 우리는 무시) |

#### 4.2.3 `knowledge` 객체 (AI 분석 결과, 선택) ✅

⚠ 우리 가정 `knowledge_card`가 아니라 `knowledge` 다. `analyzed_at !== null`인 경우만 존재.

| 필드 | 타입 | 사용 위치 |
|---|---|---|
| `knowledge` ✅ | object \| null | AI 분석 결과 (없으면 null) |
| `knowledge.tags` ✅ | string[] | 태그 표시 |
| `knowledge.category` ✅ | string | 카테고리 분류 |
| `knowledge.priority` ✅ | enum (`low`/`medium`/`high`?) | 우선순위 |
| `knowledge.knowledge_summary` ✅ | string | **AI 요약 (가장 중요!)** |
| `knowledge.key_insights` ✅ | array | 인사이트 카드 (아래 참조) |
| `knowledge.key_insights[].insight` ✅ | string | 인사이트 제목 |
| `knowledge.key_insights[].detail` ✅ | string | 인사이트 상세 |
| `knowledge.key_insights[].actionable` ✅ | boolean | 실행 가능 여부 |
| `knowledge.action_items` ✅ | string[] | 액션 아이템 목록 |
| `knowledge.methods_and_tips` ✅ | array | 실행 팁 |
| `knowledge.key_quotes` ✅ | array | 핵심 인용구 |
| `knowledge.discoveries` ✅ | array | 발견사항 |
| `knowledge.relevance_score` ✅ | number | top-level과 중복 |

### 4.3 `facets` 객체 ✅
| 필드 | 타입 | 사용 |
|---|---|---|
| `facets.sources` ✅ | `{ [source]: count }` | 소스별 카운트 |
| `facets.categories` ✅ | `{ [category]: count }` | 카테고리별 카운트 |
| `facets.priorities` ✅ | `{ [priority]: count }` | 우선순위별 카운트 |
| `facets.tags` ✅ | `{ [tag]: count }` | 태그별 카운트 |

### 4.4 `infohub_topics` 응답 필드 ✅

> 출처: 2026-04-07 `infohub_topics()` 실 호출 결과 ✅

```typescript
{
  topics: [{
    id: string;                          // UUID
    user_id: string;                     // UUID
    name: string;                        // "AI / 인공지능"
    description: string;                 // 빈 문자열 가능
    color: string;                       // hex (#8B5CF6)
    icon: string;                        // emoji ("🤖")
    is_active: boolean;
    auto_collect: boolean;
    sort_order: number;
    created_at: string;                  // ISO+TZ
    updated_at: string;                  // ISO+TZ
    project_context: object;             // 빈 객체 가능
    notion_database_id: string | null;
    ia_topic_keywords: Array<{           // ia_ 접두사 (InfoHub ADR-001)
      id: number;                        // auto-increment
      keyword: string;
      language: 'both' | 'ko' | 'en';
      topic_id: string;                  // FK
      created_at: string;
      is_negative: boolean;
    }>;
    keywords: Array<...>;                // ⚠ ia_topic_keywords와 중복 (별칭)
    unread_count: number;
  }];
}
```

⚠ **중요**: `keywords`와 `ia_topic_keywords`가 중복된다. 우리는 `ia_topic_keywords`만 사용하고 `keywords`는 무시한다 (zod에서는 둘 다 받되 사용하지 않음).

### 4.5 `infohub_collect` 응답 필드 ✅

> 출처: 2026-04-07 `infohub_collect({ keyword, sources, autoAnalyze })` 실 호출 결과 ✅

```typescript
{
  success: boolean;                      // REST 표준
  keyword: string;                       // 입력 echo
  results: Array<{
    source: string;
    found: number;                       // 검색된 총 건수
    new_items: number;                   // 중복 제외 신규
    duplicates: number;
  }>;
  total_new: number;                     // 모든 source 합계
  english_keyword: string;               // 한↔영 자동 번역 결과
}
```

⚠ **중요**: `infohub_collect` 응답에는 **실제 아이템 데이터가 없다**. 카운트만 반환. 실제 데이터는 `infohub_search` 또는 `infohub_knowledge`로 이어서 호출해야 한다.

### 4.6 의존 엔드포인트 목록
| 엔드포인트 | 사용 도구 | 변경 시 영향 |
|---|---|---|
| `GET /api/items` | `infohub_search`, `infohub_knowledge` | 검색/지식 조회 페이지 깨짐 |
| `POST /api/collect` | `infohub_collect` | 신규 수집 트리거 깨짐 |
| `POST /api/analyze` | `infohub_analyze` | (Phase 2) 분석 트리거 깨짐 |
| `GET /api/topics` | `infohub_topics` | 토픽 셀렉터 깨짐 |
| `GET /api/items/export` | `infohub_export` | 내보내기 깨짐 |

### 4.7 검증 의무
- ecommerce-hub의 InfoHub 응답 파서는 **반드시 zod 스키마로 런타임 검증** (P-2/P-8 방지)
- 검증 실패 시 빈 배열 반환 금지 → `InfoHubSchemaError` throw + 사용자 알림
- 우리 가정 필드(`summary`, `url`, `knowledge_card`)는 실제로 존재하지 않음 → 정정된 §4.2 사용

### 4.8 Critical: 확정된 zod 스키마 (D-002 검증 후)

```typescript
import { z } from 'zod';

// 실제 응답 기반 (2026-04-07 검증 ✅)
export const InfoHubKnowledgeSchema = z.object({
  tags: z.array(z.string()),
  category: z.string(),
  priority: z.string(),
  knowledge_summary: z.string(),
  key_insights: z.array(z.object({
    insight: z.string(),
    detail: z.string(),
    actionable: z.boolean(),
  })),
  action_items: z.array(z.string()),
  methods_and_tips: z.array(z.unknown()),
  key_quotes: z.array(z.unknown()),
  discoveries: z.array(z.unknown()),
  relevance_score: z.number(),
}).nullable();

export const InfoHubItemSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  source_url: z.string().url(),                           // ⚠ url 아님
  title: z.string(),
  description: z.string(),                                // ⚠ summary 아님
  body_text: z.string(),
  full_text: z.string(),
  language: z.string(),
  collected_at: z.string().datetime({ offset: true }),
  analyzed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  published_at: z.string().datetime({ offset: true }),
  relevance_score: z.number(),
  is_read: z.boolean(),
  is_bookmarked: z.boolean(),
  is_archived: z.boolean(),
  is_duplicate: z.boolean(),
  knowledge: InfoHubKnowledgeSchema,                      // ⚠ knowledge_card 아님
  // 무시 가능 필드 (zod에서 받기만 함)
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

export const InfoHubSearchResponseSchema = z.object({
  items: z.array(InfoHubItemSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  facets: z.object({
    sources: z.record(z.number()),
    categories: z.record(z.number()),
    priorities: z.record(z.number()),
    tags: z.record(z.number()),
  }).optional(),
});

export type InfoHubItem = z.infer<typeof InfoHubItemSchema>;
export type InfoHubSearchResponse = z.infer<typeof InfoHubSearchResponseSchema>;
```

---

## 5. 에러 처리 정책

### 5.1 InfoHub 다운/타임아웃
| 상황 | 대응 |
|---|---|
| HTTP 401 (인증 만료) | 토큰 자동 갱신 1회 재시도 → 실패 시 명시적 에러 |
| HTTP 408 (타임아웃) | 사용자에게 "InfoHub 응답 지연 — 잠시 후 재시도" + ❓ unknown 마크 |
| HTTP 429 (Rate limit) | 60초 backoff → 1회 재시도 |
| HTTP 5xx | 즉시 ❓ unknown 반환 + Sentry 알림 |
| 네트워크 오류 | ❓ unknown 반환 |

### 5.2 응답 스키마 검증 실패
- InfoHub가 응답을 보냈지만 우리가 기대한 필드가 없거나 타입이 다름
- 대응:
  1. `InfoHubSchemaError` throw
  2. `agents/bugs.md`에 즉시 기록 (B-XXX)
  3. InfoHub 팀에 보고 (P-5 위반 가능성)
  4. 사용자에게 ❓ unknown 표시

### 5.3 빈 결과 반환 금지 (P-1 방지)
```typescript
// ❌ 틀림: 실패를 빈 배열로 은폐
async function getInfoHubKnowledge(query: string) {
  try {
    return await mcp.infohub_knowledge({ query });
  } catch {
    return [];  // P-1 위반!
  }
}

// ✅ 옳음: 명시적 에러 + ❓ 마크
async function getInfoHubKnowledge(query: string): Promise<InfoHubResult> {
  try {
    const raw = await mcp.infohub_knowledge({ query });
    return InfoHubKnowledgeSchema.parse(raw);  // zod 검증
  } catch (err) {
    throw new InfoHubError(
      `InfoHub 호출 실패: ${err instanceof Error ? err.message : 'unknown'}`,
      { confidence: 'unknown' }
    );
  }
}
```

---

## 6. 신뢰도 마킹 규칙 (ADR-007 + ADR-011)

| InfoHub 데이터 종류 | 기본 confidence | 승급 조건 |
|---|---|---|
| `infohub_collect` 직후 raw 아이템 | 🟡 estimated | 사용자가 검토 후 "확인" 클릭 → ✅ confirmed |
| `infohub_knowledge` AI 카드 | 🟡 estimated | 승급 불가 (영구 추정) |
| `infohub_search` 검색 결과 | 🟡 estimated | 사용자가 ✅ 클릭 → confirmed |
| 6시간 경과 캐시 | ❓ unknown | 재수집 필요 |

### 6.1 DB 컬럼 패턴
```typescript
// keyword_research_snapshots 테이블 (Phase 2)
{
  id: uuid().primaryKey(),
  company_id: uuid().notNull(),
  keyword: text().notNull(),
  source: text().notNull(),                        // 'infohub:naver_blog' 등
  raw_data: jsonb(),
  fetched_at: timestamp().notNull(),
  data_confidence: text().notNull().default('estimated'),  // ADR-007
  confirmed_by: uuid(),                            // 사용자가 confirm 시
  confirmed_at: timestamp(),
}
```

### 6.2 UI 표시 의무
- 모든 InfoHub 데이터는 `<ConfidenceBadge type="estimated">` 동반
- 툴팁: "InfoHub에서 수집됨 (출처: naver_blog) · 2시간 전"
- 출처 클릭 시 원문(`url`) 새 탭으로 열기

---

## 7. 환경 변수 (Phase 2 모드 B 대비)

> Phase 1 MVP는 Claude Code 세션에서 직접 호출 (모드 A)이므로 ecommerce-hub 측 환경변수 불필요.
> 아래는 Phase 2 모드 B(Next.js 앱이 InfoHub REST API 직접 호출) 도입 시 필요한 변수.

```bash
# .env.local
INFOHUB_URL=https://infohub-app-bwzkr.vercel.app
INFOHUB_AUTH_TOKEN=eyJ...   # 또는 SUPABASE_SERVICE_ROLE_KEY로 자동 갱신
INFOHUB_TIMEOUT_MS=120000   # 2분 (collect는 오래 걸림)
INFOHUB_CACHE_TTL_SEC=21600 # 6시간
```

⚠ `INFOHUB_AUTH_TOKEN`은 Supabase JWT다. 자동 갱신을 원하면 `SUPABASE_SERVICE_ROLE_KEY` 사용 (`정보취합-2/mcp-server/index.ts:32` 참조 ✅).

---

## 8. Phase 2 모드 B 구현 계획 (참고)

> Phase 1 MVP에서는 구현하지 않음. Phase 2에서 도입.

### 8.1 클라이언트 wrapper
```typescript
// src/lib/infohub/client.ts (Phase 2)
import { z } from 'zod';

const InfoHubItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  url: z.string().url(),
  collected_at: z.string().datetime(),
  relevance_score: z.number().optional(),
});

export type InfoHubItem = z.infer<typeof InfoHubItemSchema>;

export async function searchInfoHub(params: {
  query: string;
  source?: string;
  limit?: number;
}): Promise<InfoHubItem[]> {
  const url = new URL('/api/items', process.env.INFOHUB_URL);
  url.searchParams.set('q', params.query);
  if (params.source) url.searchParams.set('source', params.source);
  url.searchParams.set('limit', String(params.limit ?? 20));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.INFOHUB_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(Number(process.env.INFOHUB_TIMEOUT_MS ?? 120000)),
  });

  if (!res.ok) {
    throw new Error(`InfoHub HTTP ${res.status}: ${await res.text()}`);
  }

  const raw = await res.json();
  return z.array(InfoHubItemSchema).parse(raw);
}
```

### 8.2 API 라우트
```typescript
// app/api/research/infohub-fetch/route.ts (Phase 2)
import { NextRequest, NextResponse } from 'next/server';
import { searchInfoHub } from '@/lib/infohub/client';
import { getActiveCompany } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const { keyword, source } = await req.json();
  const ctx = await getActiveCompany(req);  // 멀티테넌트 검증

  try {
    const items = await searchInfoHub({ query: keyword, source });
    // 캐싱 + DB 저장 (company_id 포함)
    return NextResponse.json({ items, confidence: 'estimated' });
  } catch (err) {
    return NextResponse.json(
      { error: 'InfoHub 호출 실패', confidence: 'unknown' },
      { status: 502 }
    );
  }
}
```

---

## 9. 개발 시간(모드 A) 사용 절차

> Claude Code 세션에서 InfoHub MCP를 직접 호출할 때의 SOP.

### 9.1 호출 전 체크리스트
1. ✅ 어떤 BUYWISE 워크플로우 단계인가? (Research/Sourcing/Listing/Marketing/Branding)
2. ✅ 어떤 InfoHub 도구가 적합한가? (collect/search/knowledge)
3. ✅ 어떤 소스를 선택할 것인가? (한국 키워드 → naver_*, 글로벌 → google/perplexity)
4. ✅ 결과를 어디에 저장할 것인가? (메모리 / docs / DB)

### 9.2 호출 후 체크리스트
1. ✅ 응답 스키마 확인 — `id`, `title`, `summary`, `source`, `url`, `collected_at` 모두 있는가?
2. ✅ 없는 필드는 `agents/bugs.md`에 P-5 위반 가능성으로 기록
3. ✅ 결과 사용 시 🟡 estimated 마크 부여
4. ✅ DB 저장 시 `source: 'infohub:*'` 명시 + `fetched_at` 기록

### 9.3 자세한 SOP
→ `agents/infohub.md` 참조

---

## 10. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (ADR-011 기반) |
| 1.1 | 2026-04-07 | 이재홍 | D-002 검증 후 §4 대대적 정정: `summary→description`, `url→source_url`, `knowledge_card→knowledge`, wrapper 구조 추가, zod 스키마 확정 (B-001 참조) |
