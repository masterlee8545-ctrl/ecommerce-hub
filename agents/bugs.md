# BUGS — 발견된 버그 추적

> 이 문서는 발견된 버그를 등록하고 수정 상태를 추적한다.
> 모든 버그는 등록 → 진단 → 수정 → 검증 → 종결 단계를 거친다.
> mistakes.md와 다른 점: bugs.md는 일회성 결함, mistakes.md는 패턴.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |

---

## 0. 등록 양식

```markdown
### B-XXX — <짧은 제목>

| 항목 | 값 |
|---|---|
| 발견일 | YYYY-MM-DD |
| 발견자 | 사용자명 |
| 심각도 | Critical / High / Medium / Low |
| 상태 | Open / In Progress / Fixed / Verified / Closed |
| 영향 범위 | (페이지/기능명) |
| 관련 PR | (있으면) |

**증상**:
(사용자가 본 것)

**재현 절차**:
1.
2.
3.

**기대 동작**:


**실제 동작**:


**진단**:
(원인 분석)

**수정 내용**:
(어떤 파일에 어떤 변경)

**검증**:
- [ ] 단위 테스트 추가
- [ ] 회귀 테스트 통과
- [ ] 시각적 확인
- [ ] mistakes.md 패턴 등록 여부 검토
```

---

## 1. 심각도 정의

| 심각도 | 정의 | 대응 시간 |
|---|---|---|
| **Critical** | 데이터 손실, 보안 누출, 회사 간 데이터 노출, 결제 오류 | 즉시 (1시간 내) |
| **High** | 핵심 기능 동작 불가, 다수 사용자 영향 | 당일 |
| **Medium** | 일부 기능 오류, 회피 방법 존재 | 주간 |
| **Low** | UI 미세 결함, 오타, 가독성 | 다음 스프린트 |

---

## 2. 등록된 버그

### B-001 — InfoHub MCP 응답 스키마와 우리 §4.1 가정 불일치

| 항목 | 값 |
|---|---|
| 발견일 | 2026-04-07 |
| 발견자 | Claude (D-002 첫 호출 검증 중) |
| 심각도 | High |
| 상태 | Fixed |
| 영향 범위 | `docs/INFOHUB_INTEGRATION.md` §4 (스키마 정의), 향후 `lib/infohub/*` 통합 코드 전체 |
| 관련 PR | (없음 — 문서 단계) |

**증상**:
`docs/INFOHUB_INTEGRATION.md` §4.1에서 InfoHub MCP 응답 필드를 추측으로 정의했고,
실제 `mcp__infohub__*` 도구를 처음 호출했을 때 가정한 필드명이 실재하지 않음을 확인.
만약 이대로 zod 스키마/TypeScript 타입을 만들고 코드를 작성했다면, 런타임 파싱에서 전부 깨졌을 것.

**재현 절차**:
1. `mcp__f8312ce2-251a-46ae-b958-eba2124339d5__infohub_topics` 호출 → topic 객체 구조 확인
2. `mcp__f8312ce2-251a-46ae-b958-eba2124339d5__infohub_collect` 호출 (keyword="나노 세라믹 코팅", sources=["youtube","naver_blog","naver_news"]) → `{success, keyword, results, total_new, english_keyword}` wrapper 확인 (📌 한↔영 자동 번역 동작 확인)
3. `mcp__f8312ce2-251a-46ae-b958-eba2124339d5__infohub_search` 호출 → `{items, total, offset, limit, facets}` wrapper 발견 (단순 배열이 아님)
4. `mcp__f8312ce2-251a-46ae-b958-eba2124339d5__infohub_knowledge` 호출 → item 내부 필드명 확인

**기대 동작** (우리가 `INFOHUB_INTEGRATION.md` §4.1에서 가정했던 것):
- `summary: string` 단일 요약 필드 존재
- `url: string` 원문 링크
- `knowledge_card: { ... }` 지식 카드 객체

**실제 동작** (InfoHub API가 반환하는 것):
- 요약은 `description` / `body_text` / `full_text` / `knowledge.knowledge_summary` 4중 분리
- 원문 링크는 `source_url` (snake_case + 명시적 source 접두)
- 지식 카드는 `knowledge` (단수, `_card` 접미 없음)
- 응답 wrapper `{items, total, offset, limit, facets}` 가정 누락
- `published_at`, `analyzed_at`, `is_*` boolean 플래그군, `fts_vector` 등 우리가 몰랐던 필드 다수 존재

**진단**:
- 근본 원인: §4.1을 작성할 때 InfoHub 코드를 직접 확인하지 않고 "이커머스 통합관리 시스템 입장에서 필요한 필드"를 역추론으로 가정함 → CLAUDE.md P-8 위반 (형제 프로젝트 응답 스키마 가정 금지)
- 발견 시점: 다행히 코드 작성 전(D-002), 실제 MCP 호출에서 즉시 발각됨
- 만약 발견 못했다면: zod parse failure → 모든 InfoHub 관련 페이지(Research 단계 6개) 런타임 크래시 + 사용자 데이터 표시 불가 + multi-tenant 사용자별 진단 어려움

**수정 내용**:
- `docs/INFOHUB_INTEGRATION.md` §4 전면 재작성:
  - §4.1: 실제 응답 wrapper 구조 명시 (`{items, total, offset, limit, facets}`)
  - §4.2~§4.7: 각 도구별 실제 응답 예제를 ✅ confirmed로 마킹
  - §4.8: 완전한 zod 스키마 신규 추가 (`InfoHubItemSchema`, `InfoHubKnowledgeSchema`, `InfoHubSearchResponseSchema`, `InfoHubCollectResponseSchema`)
  - §4.9: 잘못된 가정 → 실제 필드 매핑 표 추가 (학습 자료)
- `agents/mistakes.md` M-009 (zod 검증 없이 사용) 사례에 본 버그 링크 추가 예정
- `agents/bugs.md` (본 문서) B-001 등록

**검증**:
- [x] 6개 InfoHub MCP 도구 모두 실호출 → 응답 구조 캡처 완료
- [x] 캡처한 응답을 zod 스키마로 mental parse → 모든 필드 매칭 확인
- [x] mistakes.md M-009 패턴과 일치 여부 검토 → 일치 (zod 미검증 위험)
- [x] CLAUDE.md P-8 위반 사례로 §10.5 외부 데이터 검증 규칙에 자동 반영됨
- [ ] 실제 lib/infohub/client.ts 작성 시 zod parse 동작 검증 (A 단계 진행 시)
- [ ] InfoHub 응답 schema fingerprint 자동 비교 스크립트 (Phase 2)

**교훈**:
1. **첫 호출은 항상 검증용으로 단독 수행하라**. 코드 작성 → 호출 → 실패 순서가 아니라, 호출 → 스키마 확정 → 코드 작성 순서가 맞다.
2. **형제 프로젝트는 우리 입장에서 "API"다**. README가 있어도 실호출 응답이 진실이다.
3. **추측 필드명은 일관성 있게 틀린다** (`summary`, `url`, `*_card` 같은 "예쁜" 영어 단어를 무의식적으로 선호) → snake_case + 명시적 prefix 가능성을 항상 의심하라.

---

## 3. 종결된 버그 (아카이브)

(아직 없음)

---

## 4. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (양식만) |
| 1.1 | 2026-04-07 | Claude (D-002) | B-001 등록 — InfoHub 스키마 가정 불일치 |
