# MISTAKES — 안티 패턴 등록부 및 에스컬레이션

> 이 문서는 과거에 발생한 실수와 그 차단 규칙을 기록한다.
> 같은 실수를 반복하면 즉시 작업 중단 + 카운트 증가.
> 4회 반복 시 세션 중단 + 근본 원인 회의.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 관련 문서 | CLAUDE.md, agents/evaluator.md |

---

## 0. 에스컬레이션 규칙

| 횟수 | 대응 |
|---|---|
| 1회 | 사용자가 수정 지시 + 이 문서에 패턴 등록 |
| 2회 | 카운트 +1, 차단 룰 검토 (lint/test) |
| 3회 | 자동 차단 룰 추가 (ESLint/Build/Test) |
| 4회 | **세션 중단**, 근본 원인 회의 |

---

## 1. 등록된 안티 패턴

### M-001 — 시각적 확인 없이 "완료" 보고
**증상**: "구현 완료", "동작합니다"라고 보고했지만 화면을 직접 확인하지 않음.

**카운트**: 0

**차단 규칙**:
- CLAUDE.md §2 자기검증 5+1의 Q1에 명시
- 보고 양식에 "Q1. 시각적 확인: <어떻게 확인했는지>" 강제

**발견 시 대응**:
1. 즉시 개발 서버 띄워 화면 확인
2. 스크린샷 또는 화면 묘사 첨부
3. 다크 모드 + 모바일 + 빈 상태 모두 확인

**예시**:
```
❌ "마진 계산기 구현 완료했습니다."
✅ "마진 계산기 구현 완료. localhost:3002/sourcing/calculator에서 확인:
   - CNY 35 입력 → KRW 9,038 표시 정상
   - 다크 모드 정상
   - 모바일 (375px) 정상
   - 빈 입력 시 에러 메시지 표시"
```

---

### M-002 — 린터/포매터가 코드를 되돌린 것 감지 못함
**증상**: 코드 작성 → `npm run lint:fix` 실행 → 린터가 일부 코드를 자동 변경 → 변경된 사실 모르고 다음 단계 진행.

**카운트**: 0

**차단 규칙**:
- 모든 lint 실행 후 `git diff` 확인 강제
- pre-commit hook이 lint 결과 stash + 보고

**발견 시 대응**:
1. `git diff`로 린터가 변경한 부분 확인
2. 의도와 다른 변경이면 ESLint 룰 점검 또는 disable + 사유 주석
3. 의도와 같으면 그대로 commit

---

### M-003 — 대충 구현하고 "완료" 보고
**증상**: TODO 주석을 남기고 "완료"라고 함. 핵심 기능이 빠진 채 보고.

**카운트**: 0

**차단 규칙**:
- ESLint 룰: `no-warning-comments` (TODO/FIXME/XXX 금지, 사유 주석 필수)
- 검증 절차: Acceptance Criteria의 모든 항목 ✅ 표시 강제

**발견 시 대응**:
1. 설계서의 검증 기준을 다시 확인
2. 누락 항목 모두 구현
3. 각 항목별로 어떻게 동작하는지 확인 결과 첨부

---

### M-004 — 환경변수 문제를 코드 문제로 착각
**증상**: API 호출 실패 → 코드를 의심하고 수정 시도 → 사실은 `.env.local`에 키 누락.

**카운트**: 0

**차단 규칙**:
- 모든 외부 API 클라이언트는 시작 시 환경변수 존재 검증
- 누락 시 명시적 에러: `Missing env: BWRANK_BASE_URL`

**발견 시 대응**:
1. 코드 수정 전에 `.env.local` 확인
2. `.env.local.example`과 비교
3. 환경변수 누락이면 코드는 그대로 두고 환경변수 추가

---

### M-005 — 설계서 없이 바로 코딩 시작
**증상**: 사용자 요구를 받자마자 코드 작성. 영향 범위/엣지 케이스 미검토.

**카운트**: 0

**차단 규칙**:
- CLAUDE.md §3 하니스 워크플로우: planner → generator → evaluator 순서 강제
- Generator는 Planner의 설계서 없이 작업 시작 금지

**발견 시 대응**:
1. 즉시 작업 중단
2. Planner 단계로 돌아가서 설계서 작성
3. 설계서 승인 후 Generator 시작

---

### M-006 — 멀티테넌트 회사 ID 필터 누락 (이커머스 특화)
**증상**: DB 쿼리에 `company_id` 필터 누락 → 다른 회사 데이터 노출 가능.

**카운트**: 0

**차단 규칙**:
- ESLint 커스텀 룰: 비즈니스 테이블에 대한 query에 `company_id` 필터 강제
- 미들웨어 이중 검증
- Supabase RLS 정책

**발견 시 대응**:
1. 즉시 작업 중단 (Critical)
2. 영향 받은 모든 쿼리에 `company_id` 필터 추가
3. 자동 테스트 작성: 다른 회사 ID로 SELECT 시 빈 결과 검증
4. 보안 사고 보고

---

### M-007 — 추정값을 확정값처럼 사용 (이커머스 특화)
**증상**: Claude가 추정한 마진율을 회계 계산이나 발주 결정에 직접 사용.

**카운트**: 0

**차단 규칙**:
- DB 컬럼 `*_confidence` 누락 시 lint 에러
- UI 컴포넌트 `<EstimatedValue>`는 항상 🟡 마크
- 회계 함수는 `confidence === 'confirmed'`만 입력 허용 (타입 가드)

**발견 시 대응**:
1. 추정값 사용처 모두 검색 (`grep "estimated"`)
2. 회계/발주 로직에서 추정값 사용 차단
3. 사용자 확정 절차 추가

---

### M-008 — 외부 API 실패를 빈 데이터로 은폐 (이커머스 특화)
**증상**: BW Rank API/쿠팡 리뷰 API 실패 시 빈 배열 반환 → 사용자가 "분석 결과 없음"으로 오해.

**카운트**: 0

**차단 규칙**:
- 모든 API 클라이언트는 실패 시 명시적 에러 throw
- `try { } catch { return [] }` 패턴 금지 (lint 룰)
- UI는 에러 상태를 빈 상태와 구분해 표시

**발견 시 대응**:
1. 모든 API 클라이언트 검토
2. 실패 시 `apiError()` 헬퍼 사용
3. UI는 "API 실패 - 다시 시도" 명시적 메시지

---

### M-009 — InfoHub 응답을 zod 검증 없이 사용 (형제 프로젝트 특화)
**증상**: InfoHub MCP 응답을 받자마자 `result.title`, `result.description` 같은 필드를 검증 없이 직접 접근. 스키마 변경 시 런타임 크래시.

**카운트**: 1 (B-001 — 코드 작성 전 D-002 호출 검증에서 가정 필드명 발각)

**관련**: CLAUDE.md §1 P-8, ADR-011, docs/INFOHUB_INTEGRATION.md §4 (전체), agents/bugs.md B-001

**차단 규칙**:
- ESLint 룰 (Phase 2): InfoHub 호출 결과를 zod parse 없이 사용 금지
- 모든 InfoHub wrapper는 `InfoHubItemSchema.parse()` 호출 강제
- 검증 실패 시 `InfoHubSchemaError` throw + bugs.md 자동 기록

**발견 시 대응**:
1. 즉시 작업 중단 (Critical)
2. `docs/INFOHUB_INTEGRATION.md` §4.1의 의존 필드 목록 확인
3. zod 스키마 정의 후 모든 InfoHub 사용처에 적용
4. InfoHub 측 `mcp-server/index.ts` Read해서 실제 응답 구조 검증
5. 차이 있으면 InfoHub 팀에 알림 (P-5/P-8 위반 가능성)

**예시** (B-001 실사례 반영):
```typescript
// ❌ 틀림: 스키마 가정 (B-001에서 발각된 패턴 — 모두 존재하지 않는 필드)
const result = await mcp.infohub_search({ query: "코팅" });
return result.map(i => ({ title: i.title, body: i.summary, link: i.url }));
//     ^^^^^^^^^^                                ^^^^^^^^^         ^^^^^
//     단순 배열 아님                            description임      source_url임

// ✅ 옳음: zod 검증 (D-002에서 확정한 실제 스키마)
import { z } from 'zod';
import { InfoHubSearchResponseSchema } from '@/lib/infohub/schema';

const raw = await mcp.infohub_search({ query: "코팅" });
const parsed = InfoHubSearchResponseSchema.parse(raw);  // {items, total, offset, limit, facets}
return parsed.items.map(i => ({
  title: i.title,
  body: i.description,                       // ⚠ summary 아님
  source_url: i.source_url,                  // ⚠ url 아님
  knowledge_summary: i.knowledge?.knowledge_summary,  // ⚠ knowledge_card 아님
  source: `infohub:${i.source}`,             // 출처 명시
  confidence: 'estimated' as const,          // 🟡 강제 (ADR-007 + ADR-011)
}));
```

---

### M-010 — 형제 프로젝트 코드 무단 수정 (Cross-Project 특화)
**증상**: ecommerce-hub 작업 중 `C:/개발/정보취합-2/`, `C:/개발/naver-keyword정환/` 등 형제 프로젝트 파일을 직접 수정.

**카운트**: 0

**관련**: CLAUDE.md §1 P-8, §8 형제 프로젝트 계약, docs/CROSS_PROJECT_SYNC.md §8.2

**차단 규칙**:
- 작업 시작 시 working directory를 `C:/개발/ecommerce-hub`로 명시
- Edit/Write 호출 전 path가 `ecommerce-hub` 하위인지 확인
- pre-commit hook에서 형제 프로젝트 경로 변경 감지 시 차단

**발견 시 대응**:
1. 작업 즉시 중단
2. 사용자에게 보고: "P-8 위반 — 형제 프로젝트 무단 수정 시도"
3. 변경 내용 git restore (사용자 승인 필요)
4. 같은 작업이 형제 프로젝트 변경 없이 가능한지 재설계
5. 정말 형제 프로젝트 변경이 필요하면 해당 프로젝트로 이동해서 별도 PR

**예시**:
```typescript
// ❌ 틀림: ecommerce-hub 작업 중 InfoHub 코드 수정
Edit({
  file_path: "C:/개발/정보취합-2/mcp-server/index.ts",
  old_string: "...",
  new_string: "..."
})

// ✅ 옳음: ecommerce-hub 안에서만 작업
Edit({
  file_path: "C:/개발/ecommerce-hub/src/lib/infohub/client.ts",
  ...
})
// + 정말 InfoHub 변경이 필요하면 사용자에게 별도 작업 제안
```

---

### M-011 — 6시간 경과 InfoHub 캐시를 fresh로 처리
**증상**: InfoHub에서 가져온 데이터를 캐시에 저장한 후, 6시간이 지났는데도 🟡 estimated로 계속 사용. ❓ unknown으로 다운그레이드 누락.

**카운트**: 0

**관련**: ADR-011, agents/infohub.md §6 G-5, docs/INFOHUB_INTEGRATION.md §6

**차단 규칙**:
- DB 조회 시 자동 TTL 검증: `fetched_at + 6h < now()` → confidence를 'unknown'으로 변환
- 캐시 로직에 단위 테스트: 5h 59m → estimated, 6h 01m → unknown 검증

**발견 시 대응**:
1. 모든 InfoHub 사용처 검색
2. TTL 체크 로직 추가
3. 만료된 데이터는 재수집 또는 ❓ unknown 표시
4. 단위 테스트 추가

**예시**:
```typescript
// ❌ 틀림: 캐시 시간 무시
const cached = await db.query.keywordResearchSnapshots.findFirst(...);
return { data: cached.raw_data, confidence: 'estimated' };  // 6시간 경과해도 🟡

// ✅ 옳음: TTL 검증
const cached = await db.query.keywordResearchSnapshots.findFirst(...);
if (!cached) return { data: null, confidence: 'unknown' };

const ageHours = (Date.now() - cached.fetched_at.getTime()) / 3_600_000;
const TTL_HOURS = 6;
return {
  data: cached.raw_data,
  confidence: ageHours > TTL_HOURS ? 'unknown' : 'estimated',
  fetched_at: cached.fetched_at,
};
```

---

### M-012 — 시간/날짜를 추측해서 보고 (할루시네이션 특화)
**증상**: "오늘은 2026년 X월 X일" 같은 진술을 시스템 시간 확인 없이 추측. 또는 "어제", "지난주" 같은 상대 시간을 검증 없이 사용.

**카운트**: 0

**관련**: CLAUDE.md §11 (anti-hallucination), §1 P-2

**차단 규칙**:
- 모든 시간/날짜 진술은 다음 중 하나의 출처를 가져야 함:
  - 시스템 reminder (`<currentDate>` 태그)
  - `Bash("date")` 실행 결과
  - DB의 `created_at`, `updated_at` 컬럼 값
  - `new Date()` 또는 `Date.now()` 호출
- 상대 시간 표현(`yesterday`, `last week`)은 절대값으로 변환 후 표시

**발견 시 대응**:
1. 시간 진술의 근거 확인
2. 근거 없으면 시스템 시간 재확인
3. 보고서/UI에 모든 시각은 ISO 8601 또는 명시적 포맷

**예시**:
```
❌ "어제 오류가 발생했습니다."
✅ "2026-04-06 14:23:11 KST에 오류 발생 (출처: bugs.md B-001)"

❌ "지금은 2026년 봄이니 트렌드는..."
✅ "현재 2026-04-07 (시스템 시간 ✅), 봄 트렌드 키워드 분석 진행"
```

---

### M-013 — 라이브러리 버전/존재를 추측 (할루시네이션 특화)
**증상**: "Next.js 15에는 X 기능이 있을 것이다", "Drizzle ORM의 Y 메서드를 사용한다"고 단정했지만 실제로는 없거나 다른 시그니처.

**카운트**: 0

**관련**: CLAUDE.md §11, §1 P-2

**차단 규칙**:
- 라이브러리 버전 진술 시 `package.json` 또는 `package-lock.json` Read 후
- 라이브러리 API 진술 시 `node_modules/<lib>/dist/*.d.ts` Read 후
- 또는 공식 문서 URL을 출처로 첨부 (WebFetch)

**발견 시 대응**:
1. 진술된 API/기능의 실존 확인
2. 없으면 코드 수정 + 작업 보고서 정정
3. 있어도 시그니처 다르면 동일

**예시**:
```typescript
// ❌ 틀림: 시그니처 추측
import { drizzleHelpers } from 'drizzle-orm';  // 이런 export 없음
const result = drizzleHelpers.softDelete(table, id);  // 이런 메서드 없음

// ✅ 옳음: 실제 존재 확인 후
// node_modules/drizzle-orm/index.d.ts Read
import { eq } from 'drizzle-orm';
const result = await db.update(table)
  .set({ deleted_at: new Date() })
  .where(eq(table.id, id));
```

---

### M-014 — "있을 것이다" 추측으로 파일 경로/존재 가정 (할루시네이션 특화)
**증상**: `app/dashboard/page.tsx`가 있을 것이라고 가정하고 import 작성. 실제로는 없음.

**카운트**: 0

**관련**: CLAUDE.md §11, §1 P-2

**차단 규칙**:
- 새 import 추가 시 대상 파일 Glob/Read로 존재 확인
- 새 컴포넌트/함수 사용 시 export 확인
- pre-commit hook에서 import 경로 검증 (TypeScript가 자동으로)

**발견 시 대응**:
1. import 대상 파일을 Glob/Read로 확인
2. 없으면 먼저 생성 (Planner 단계로 돌아감)
3. 있으면 export 확인

---

### M-015 — 파괴적 명령 '안전' 가정 (Bash 특화)
**증상**: `rm -rf node_modules`, `git reset --hard`, `DROP TABLE` 같은 파괴적 명령을 "안전할 것이다"라고 가정하고 실행.

**카운트**: 0

**관련**: CLAUDE.md §1 P-6

**차단 규칙**:
- 파괴적 명령 목록을 Bash wrapper에서 차단
- 사용자 명시적 승인("yes", "rm 해줘", "reset 해줘") 있을 때만 허용
- Git 작업은 항상 새 commit으로 (amend/reset 금지)

**발견 시 대응**:
1. 즉시 작업 중단
2. 사용자에게 보고
3. 가능하면 백업/복원
4. mistakes.md에 패턴 추가 (재발 방지)

---

### M-016 — 사용자에게 전문용어 무설명 사용 (커뮤니케이션 안티패턴)
**증상**: 사용자(이재홍 대표, 비개발자)에게 보고하면서 "쿼리", "스키마", "마이그레이션", "ORM", "RLS", "API", "JWT" 같은 기술 용어를 풀이 없이 그대로 던짐. 사용자가 메시지를 이해하지 못해 작업이 멈춤.

**카운트**: 0

**관련**: CLAUDE.md §1 P-9, §11, docs/GLOSSARY.md

**차단 규칙**:
- 메시지 송신 전 §11.3 자가검열 체크리스트 6항목 통과 강제
- 한 문장에 모르는 단어 2개 이상 등장 금지 (등장 시 두 문장으로 쪼개기)
- 영어 약어는 첫 등장 시 `약어 (= 한국어 풀이)` 형식 강제
- §11.2 빠른 참조 표 우선 적용, 표에 없으면 docs/GLOSSARY.md 참조
- 4회 누적 시 자동 차단 룰 검토 (메시지 발송 전 lint pass)

**발견 시 대응**:
1. 그 메시지는 무효 처리
2. 다음 메시지 첫 줄에서 사과: "방금 [단어] 설명을 빼먹었어요. 다시 풀어드릴게요"
3. 풀어 쓴 버전 재전송
4. `docs/GLOSSARY.md`에 누락 단어 추가 (없었으면 신설)
5. 본 카운트 +1
6. 같은 단어 2회 이상 누락 시 §11.2 표에 강제 등재

**예시**:
```
❌ 틀림: "스키마 마이그레이션 실행했고 RLS 정책도 적용했어요. 쿼리 테스트도 통과했습니다."
   → 한 문장에 4개 모르는 단어 (스키마/마이그레이션/RLS/쿼리), P-9 위반

✅ 옳음:
"DB(= 데이터 저장소)의 표 구조를 새로 만들었어요.
- 표 21개가 생겼습니다 (마이그레이션 = 집 리모델링 같은 거예요)
- 회사별 잠금장치(RLS = 아파트 호수별 잠금)도 켰습니다
- 데이터 뽑기 테스트(쿼리 = 사서에게 책 묻는 것)도 통과했어요"
```

**근본 원인**:
- 개발자의 직업적 습관 (전문용어가 더 정확하다고 느낌)
- 사용자가 "안다"고 가정 (확인 안 함)
- 보고를 빨리 끝내려는 압박

**예방책**:
- 모든 보고서 작성 시 §11.5 4줄 양식 사용 ("지금부터 / 이게 뭔데 / 끝나면 보이는 것 / 다음 액션")
- 작성 후 송신 전 사용자 페르소나(§11.1)로 한번 읽어보기

---

## 2. 새 안티 패턴 추가 양식

```markdown
### M-XXX — <짧은 제목>
**증상**: <어떤 실수가 일어났는지>

**카운트**: 0

**차단 규칙**:
- <어떻게 차단할지>

**발견 시 대응**:
1. <단계 1>
2. <단계 2>

**예시**:
```
❌ <틀린 예>
✅ <옳은 예>
```
```

---

## 3. 사용자 지시 (User Directives)

사용자가 명시한 영구 지시 사항. 위반 시 즉시 중단.

### D-001 — 코드 작성 전 설계서 먼저
사용자: "바로 만들지말고 설계도부터줘"
→ 모든 작업은 Planner 설계서 → Generator 구현 순서

### D-002 — 헌법/ADR/SPEC 우선
사용자: "지금 코드 짜지 마. 파일 만들지 마. 폴더도 만들지 마."
→ 사용자의 명시적 OK 없이 파일/폴더 생성 금지

### D-003 — 신뢰도 마킹 강제
사용자: "추측하지 마"
→ 모든 외부 데이터에 ✅/🟡/❓ 표시 강제

### D-004 — 멀티테넌트 안전
사용자: "3개 회사 한 시스템"
→ 모든 비즈니스 쿼리에 `company_id` 필터 강제

### D-005 — UI/UX 미리보기 우선
사용자: "ui ux 어떻게 나오는지 html로 보여줘"
→ 큰 UI 변경 전에 HTML 목업 또는 스크린샷으로 사용자 승인

### D-006 — 단계별 OK 후 진행
사용자: "고고고" / "STEP 1 OK"
→ 다음 STEP은 사용자의 명시적 OK 후만 진행
→ 임의로 STEP을 건너뛰거나 합치지 않음

### D-007 — InfoHub는 형제 프로젝트, 무단 수정 금지
사용자가 명시한 적 없지만 InfoHub CLAUDE.md §P-5와 우리 ADR-011에서 양방향 합의된 계약
→ ecommerce-hub 작업 중 `C:/개발/정보취합-2/` 절대 수정 금지

---

## 4. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (M-001 ~ M-008, D-001 ~ D-005) |
| 1.1 | 2026-04-07 | 이재홍 | M-009 ~ M-015 추가 (InfoHub/형제 프로젝트/할루시네이션 패턴), D-006 ~ D-007 추가 |
| 1.2 | 2026-04-07 | Claude (D-002) | M-009 카운트 1로 갱신 + 예시 코드 B-001 실사례 반영 (`description`/`source_url`/`knowledge`) |
| 1.3 | 2026-04-07 | 이재홍 + Claude | M-016 추가 (사용자에게 전문용어 무설명 사용 — CLAUDE.md P-9 운영 안티패턴) |
