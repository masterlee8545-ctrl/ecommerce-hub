# Agent: InfoHub 데이터 사용 SOP

> 이 문서는 ecommerce-hub Claude 세션이 InfoHub MCP를 호출할 때의 표준 운영 절차다.
> 모든 InfoHub 호출은 이 SOP를 따라야 한다.
> 위반 시 Evaluator 자동 FAIL.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 상위 문서 | docs/INFOHUB_INTEGRATION.md, docs/ADR.md (ADR-011) |
| 헌법 | CLAUDE.md §1 P-1, P-2, P-3 |

---

## 1. 역할

이 에이전트는 다음 상황에서 발동한다:
- 사용자가 키워드/시장/공급사/광고/브랜드 관련 외부 정보를 요구할 때
- BUYWISE 6단계 파이프라인 중 정보 수집이 필요한 모든 시점
- Planner가 "InfoHub 호출 필요"를 명시한 작업

이 에이전트는 다음 상황에서는 발동하지 **않는다**:
- BW Rank API로 충분한 경우 (쿠팡 상품 점수, 매출 등 → ADR-006)
- Coupang Review API로 충분한 경우 (1페이지 36개 리뷰 → ADR-008)
- 사용자가 직접 입력한 데이터로 충분한 경우

---

## 2. 호출 전 필수 점검 (Pre-Call Checklist)

InfoHub MCP를 호출하기 **전에** 다음 5개 질문에 답한다:

### Q1. 어떤 BUYWISE 단계인가?
- [ ] Research (키워드 발굴, 시장 트렌드)
- [ ] Sourcing (공급사 평판)
- [ ] Listing (상품명/카피라이팅 노하우)
- [ ] Marketing (광고/SEO 운영 인사이트)
- [ ] Branding (자사 브랜드 멘션)

### Q2. 어떤 InfoHub 도구가 적합한가?
| 목적 | 도구 |
|---|---|
| 신선한 데이터가 필요 (오늘 처음 검색하는 키워드) | `infohub_collect` |
| 이미 수집된 것 검색 | `infohub_search` |
| AI 분석된 인사이트 카드 | `infohub_knowledge` |
| 토픽 목록 확인 | `infohub_topics` |
| 리포트 생성 | `infohub_export` |

### Q3. 어떤 소스를 선택할 것인가?
| 키워드 성격 | 권장 소스 |
|---|---|
| 한국 소비자 트렌드 | `naver_blog`, `naver_news`, `naver_cafe`, `youtube` |
| 한국 개발/기술 | `velog`, `naver-d2`, `kakao-tech`, `yozm-it`, `okky` |
| 글로벌 시장 조사 | `google`, `perplexity` |
| 글로벌 기술 동향 | `hackernews`, `arxiv`, `github`, `medium`, `tldr` |
| 마케팅/SEO 노하우 | `blackhatworld`, `youtube`, `producthunt` |
| 브랜드 멘션 모니터링 | `naver_blog`, `naver_news`, `naver_cafe`, `instagram` |
| AI/ML 모델 정보 | `huggingface`, `arxiv`, `hackernews` |

### Q4. 결과를 어디에 저장할 것인가?
- [ ] 메모리 (일회성 분석)
- [ ] `docs/research/<keyword>.md` (장기 보관)
- [ ] DB `keyword_research_snapshots` 테이블 (Phase 2)

### Q5. 신뢰도 마킹은 무엇인가?
- 기본: **🟡 estimated**
- 6시간 경과: **❓ unknown**으로 다운그레이드
- 사용자 검토 후 확정: **✅ confirmed** (사용자만 가능)

---

## 3. 호출 패턴 (Call Patterns)

### 3.1 패턴 A: 신선한 데이터 수집 + 즉시 분석
```typescript
// 1. 수집 트리거 (autoAnalyze: true로 즉시 AI 분석)
mcp__infohub__infohub_collect({
  keyword: "<키워드>",
  sources: ["naver_blog", "naver_news"],
  autoAnalyze: true,
});

// 2. 잠시 대기 (collect는 최대 2분)

// 3. 분석된 지식 카드 조회
mcp__infohub__infohub_knowledge({
  query: "<키워드>",
  limit: 5,
});
```

### 3.2 패턴 B: 기존 데이터 검색
```typescript
mcp__infohub__infohub_search({
  query: "<쿼리>",
  source: "naver_blog",  // 단일 소스 필터
  limit: 20,
  sort: "relevance_score",
  knowledgeOnly: true,   // 분석된 것만
});
```

### 3.3 패턴 C: 토픽 기반 분석
```typescript
// 1. 토픽 목록 조회
mcp__infohub__infohub_topics();

// 2. 특정 토픽 내에서 분석
mcp__infohub__infohub_analyze({
  topicId: "<UUID>",
  batchSize: 20,
});
```

### 3.4 패턴 D: 리포트 생성
```typescript
mcp__infohub__infohub_export({
  topicId: "<UUID>",
  format: "markdown",
});
// 결과를 docs/reports/<날짜>-<주제>.md에 저장
```

---

## 4. 호출 후 필수 검증 (Post-Call Verification)

### 4.1 응답 스키마 검증
InfoHub 응답을 받은 즉시 다음을 확인:

```typescript
// 응답 예상 구조 (docs/INFOHUB_INTEGRATION.md §4.1 참조)
{
  id: "uuid-string",
  title: "...",
  summary: "...",
  source: "naver_blog",
  url: "https://...",
  collected_at: "2026-04-07T...",
  // 선택 필드
  relevance_score: 0.85,
  knowledge_card: { insights: [...], tips: [...] }
}
```

체크리스트:
- [ ] `id`, `title`, `summary`, `source`, `url`, `collected_at` 모두 존재?
- [ ] 타입이 예상과 같은가? (id는 string, score는 number 등)
- [ ] 빈 응답이 아닌가? (빈 응답 → P-1 위반 가능)

### 4.2 스키마 깨짐 발견 시
1. **즉시** `agents/bugs.md`에 P-5 위반 가능성으로 기록
2. 사용자에게 보고: "InfoHub 응답 스키마 변경 감지됨, ADR-011 검토 필요"
3. 정보취합-2 프로젝트의 `mcp-server/index.ts`를 Read해서 실제 변경사항 확인
4. ecommerce-hub의 의존 코드 영향도 분석
5. ADR-011 또는 docs/INFOHUB_INTEGRATION.md §4.1 갱신

### 4.3 빈 응답 처리
```typescript
// ❌ 틀림: 빈 결과를 무시
const items = await mcp.infohub_search(...);
return items;  // 빈 배열일 수 있음

// ✅ 옳음: 명시적 처리
const items = await mcp.infohub_search(...);
if (items.length === 0) {
  // 사용자에게 알림
  console.warn(`InfoHub: "${query}"에 대한 결과 없음. 다른 키워드 시도 권장.`);
  return { items: [], confidence: 'unknown', reason: 'no_results' };
}
return { items, confidence: 'estimated' };
```

---

## 5. 결과 사용 시 신뢰도 마킹

### 5.1 보고서/문서 작성 시
```markdown
## 시장 동향 (출처: InfoHub)
- 2026년 1분기 "나노 코팅" 검색량 +45% 🟡 (출처: naver_blog 12건, 2시간 전 수집)
- 주요 경쟁 브랜드: A, B, C 🟡 (출처: youtube 8건)

> ⚠ 위 데이터는 InfoHub에서 수집된 추정값입니다. 의사결정 전 ✅ 확정값으로 검증 필요.
```

### 5.2 코드에서 데이터 처리 시
```typescript
import { z } from 'zod';

// InfoHub 응답 스키마 (zod로 런타임 검증)
const InfoHubItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  url: z.string().url(),
  collected_at: z.string().datetime(),
  relevance_score: z.number().optional(),
});

type InfoHubItem = z.infer<typeof InfoHubItemSchema>;

// BUYWISE 도메인 타입으로 변환 시 confidence 강제
type ResearchInsight = {
  text: string;
  source: `infohub:${string}`;  // ADR-011: 출처 컬럼 강제
  fetchedAt: Date;
  confidence: 'estimated' | 'unknown';  // 'confirmed' 금지 (사용자만 가능)
};

function toResearchInsight(raw: unknown): ResearchInsight {
  const item = InfoHubItemSchema.parse(raw);  // 런타임 검증
  const ageHours = (Date.now() - new Date(item.collected_at).getTime()) / 3_600_000;

  return {
    text: item.summary,
    source: `infohub:${item.source}`,
    fetchedAt: new Date(item.collected_at),
    confidence: ageHours > 6 ? 'unknown' : 'estimated',  // 6시간 TTL
  };
}
```

### 5.3 UI 표시 시
```tsx
<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
  <ConfidenceBadge type="estimated" />
  <p className="mt-2">{insight.text}</p>
  <a href={insight.url} target="_blank" rel="noopener" className="text-xs text-gray-500">
    출처: {insight.source} · {formatRelativeTime(insight.fetchedAt)}
  </a>
</div>
```

---

## 6. 절대 금지 사항

### 🚫 G-1. ✅ confirmed 마킹 금지
InfoHub 데이터는 영구적으로 🟡 estimated 또는 ❓ unknown 만 가능하다.
✅ confirmed로 승급은 **사용자가 UI에서 직접 검토 후 클릭한 경우에만** 가능.

### 🚫 G-2. 빈 결과 은폐 금지
InfoHub 호출이 실패하거나 빈 결과가 나오면 **반드시** 사용자에게 알린다.
빈 배열로 정상 응답인 척 위장 금지 (P-1 위반).

### 🚫 G-3. 출처 누락 금지
InfoHub 데이터를 사용할 때는 **반드시** `source: 'infohub:*'` 형식으로 출처 명시.
"이 정보는 인터넷에서 가져왔다"는 모호한 표현 금지.

### 🚫 G-4. 응답 스키마 가정 금지
InfoHub 응답 필드를 검증 없이 사용 금지.
**반드시** zod 스키마로 런타임 검증 후 사용.

### 🚫 G-5. 캐싱 정책 우회 금지
6시간 이상 경과한 InfoHub 데이터는 ❓ unknown 으로 다운그레이드.
"오래됐지만 그래도 쓰자" 금지.

### 🚫 G-6. 회계/마진 계산에 직접 사용 금지
InfoHub 데이터(예: "경쟁사 가격은 ₩X")를 마진 계산에 직접 사용 금지.
사용자가 ✅ confirmed로 승급한 후에만 회계 계산에 사용 가능 (ADR-007).

### 🚫 G-7. InfoHub MCP 응답 스키마 변경 시도 금지
InfoHub 측 `mcp-server/index.ts`를 ecommerce-hub 작업 중 수정 금지.
스키마 변경이 필요하면 InfoHub 프로젝트로 이동해서 수행 + ADR-011 갱신.

---

## 7. 자주 묻는 시나리오 (FAQ)

### Q: 사용자가 "이 키워드 트렌드 봐줘"라고 했다. 어떻게?
1. Q1~Q5 점검 (Research 단계, infohub_collect, naver_*, 메모리, 🟡)
2. `infohub_collect({ keyword, sources: ['naver_blog', 'naver_news', 'youtube'] })`
3. ~30초 대기
4. `infohub_knowledge({ query: keyword, limit: 5 })`
5. 결과를 사용자에게 보고:
   ```
   📊 "<키워드>" 트렌드 (InfoHub 수집)
   🟡 인사이트 1: ...
   🟡 인사이트 2: ...
   출처: naver_blog 12건, naver_news 5건, youtube 8건
   ```

### Q: 사용자가 "공급사 X의 평판 알려줘"라고 했다.
1. Q1~Q5 점검 (Sourcing 단계, infohub_collect, google+perplexity+blackhatworld, 메모리, 🟡)
2. `infohub_collect({ keyword: "X manufacturer scam OR review", sources: ["google", "perplexity", "blackhatworld"] })`
3. `infohub_knowledge({ query: "X 평판", limit: 10 })`
4. 부정적 멘션 vs 긍정적 멘션 비율 보고 (🟡 추정임을 명시)

### Q: InfoHub에 토픽이 없는데 사용자가 "마케팅 자료 모아줘"라고 했다.
1. `infohub_topics()` → 기존 토픽 확인
2. 적절한 토픽 없으면 사용자에게 InfoHub에서 직접 토픽 생성 안내
3. ❌ ecommerce-hub에서 InfoHub 토픽 생성 금지 (InfoHub 책임 영역)

### Q: InfoHub가 응답하지 않는다 (HTTP 408 타임아웃).
1. **빈 결과 반환 금지** (P-1)
2. 사용자에게 명시적 보고: "InfoHub 응답 지연, 잠시 후 재시도 권장"
3. 해당 데이터 없이 진행할 수 없는 워크플로우면 작업 중단
4. 진행 가능하면 ❓ unknown 마크로 표시 후 진행

### Q: InfoHub에서 받은 가격 정보를 마진 계산에 쓸 수 있나?
**아니오 (G-6 위반).** InfoHub 가격은 🟡 estimated 다.
사용자가 그 가격을 보고 직접 입력 → ✅ confirmed로 변환된 후에만 회계 계산에 사용.

---

## 8. 보고 형식

InfoHub를 호출한 작업을 완료할 때는 다음 형식으로 보고:

```markdown
## InfoHub 호출 보고

### 호출 정보
- 도구: <infohub_collect | infohub_search | ...>
- 키워드: "<...>"
- 소스: [...]
- BUYWISE 단계: <Research | Sourcing | ...>

### 결과 요약
- 수집/검색된 아이템 수: N
- 응답 시간: <초>
- 스키마 검증: ✅ 통과 / ❌ 실패 (실패 시 bugs.md 기록)

### 신뢰도 마킹
- 모든 데이터: 🟡 estimated
- 캐시 만료 시점: <시각>
- 사용자 확정 필요: <항목 목록>

### 사용자 액션 필요
- [ ] 결과 검토 후 ✅ confirmed로 승급할 항목 선택
- [ ] 추가 키워드 수집 필요성 검토
```

---

## 9. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (ADR-011 + INFOHUB_INTEGRATION.md 기반) |
