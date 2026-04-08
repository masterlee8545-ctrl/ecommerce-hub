# ADR — Architecture Decision Records (아키텍처 결정 기록)

> 이 문서는 "왜 이렇게 설계했는가"의 단일 근거다.
> 모든 아키텍처 결정은 ADR 번호로 기록되며, 변경 시 새 ADR을 추가하고 기존 ADR은 `Superseded`로 표시한다.
> ADR 결정과 충돌하는 코드는 **즉시 불합격**.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 관련 문서 | CPS.md, SPEC.md, DATA_MODEL.md |

---

## ADR-001 — Next.js 15 (App Router) + TypeScript + Vercel

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
이커머스 통합 관리 시스템은 복잡한 폼, 실시간 데이터, 멀티 페이지 워크플로우를 가진다.

### 결정
- 프레임워크: **Next.js 15 (App Router)**
- 언어: **TypeScript (strict)**
- 배포: **Vercel**

### 이유
- App Router의 Server Components로 데이터 페칭 단순화
- Server Actions로 별도 API 라우트 최소화
- TypeScript strict 모드로 런타임 오류 사전 차단
- Vercel 자동 멀티 리전 배포 + 무중단

### 결과
- `app/` 디렉토리 기반 라우팅
- 모든 폼은 Server Actions 우선
- API 라우트는 외부 통합/웹훅 전용 (`app/api/*`)

### 대안 검토
- Remix: 학습 곡선, 한국 생태계 약함
- Vite + React: SSR/캐싱 직접 구현 부담
- Nuxt: Vue 생태계, 팀 경험 부족

---

## ADR-002 — Supabase (PostgreSQL) + Drizzle ORM

**상태**: Accepted (Supersedes 초기 SQLite 안)
**날짜**: 2026-04-07

### 배경
초기 STEP 0에서는 SQLite + VPS를 고려했으나, **3개 회사 멀티테넌트** 요구사항이 추가되며 RLS와 동시 접속이 필요해졌다.

### 결정
- DB: **Supabase (PostgreSQL)**
- ORM: **Drizzle ORM**
- 인증 백엔드: Supabase Auth (NextAuth.js와 연동)
- 마이그레이션: `drizzle-kit`

### 이유
- PostgreSQL RLS가 멀티테넌트 강제 분리에 적합
- Supabase는 매니지드 + RLS UI 제공 + 무료 티어
- Drizzle은 TypeScript 친화적, 마이그레이션 명시적
- Vercel과 같은 리전 배포 가능

### 대안 검토
- Prisma: 잘 알려졌지만 빌드 사이즈 큼, schema 파일 관리 부담
- TypeORM: 데코레이터 패턴, App Router와 궁합 안 좋음
- Raw SQL: 타입 안전성 손실

### 결과
- `src/lib/db/schema.ts`에 Drizzle 스키마 정의
- 모든 비즈니스 테이블에 `company_id` FK 필수
- Supabase RLS 정책 자동 테스트 작성

---

## ADR-003 — shadcn/ui + Tailwind CSS + Pretendard + Recharts

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
디자인 일관성과 한국 사용자 가독성, 차트 시각화가 필요하다.

### 결정
- 컴포넌트: **shadcn/ui** (Radix UI 기반)
- 스타일: **Tailwind CSS**
- 폰트: **Pretendard Variable** (한국어)
- 차트: **Recharts**
- 메인 컬러: **Teal `#0D9488`**, Navy `#111827`

### 이유
- shadcn/ui는 컴포넌트 소유 (vendor lock-in 없음)
- Tailwind는 디자인 시스템 일관성 유지
- Pretendard는 한국어 가독성 표준
- Recharts는 React 친화적 + 한국 사용자에게 익숙

### 결과
- `src/components/ui/` — shadcn 컴포넌트
- `tailwind.config.ts`에 BUYWISE 컬러 토큰 정의
- 모든 차트는 Recharts (D3 직접 사용 금지)

---

## ADR-004 — NextAuth.js v5 + 멀티테넌트 (company_id 기반)

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
3개 회사 데이터를 완전히 분리하면서, 한 사용자가 여러 회사에 접근할 수 있어야 한다.

### 결정
- 인증: **NextAuth.js v5 (Auth.js)**
- 세션: JWT (Edge 호환)
- 멀티테넌트: `companies` + `users` + `user_companies` (다대다)
- 활성 회사: 세션 쿠키 (`active_company_id`)
- DB 차단: Supabase RLS + 미들웨어 이중 검증

### 이유
- NextAuth v5는 App Router 정식 지원
- JWT는 Edge Runtime 친화 (Vercel Edge Middleware)
- RLS만으로는 부족 (앱 코드 실수 가능) → 미들웨어 이중 검증 필수

### 결과
- `src/middleware.ts`에서 모든 요청에 `company_id` 검증
- DB 쿼리는 항상 `where(eq(table.company_id, ctx.company_id))` 강제
- 누출 시 즉시 불합격

### 위반 시
- ❌ 회사 ID 없이 SELECT
- ❌ 다른 회사의 ID로 UPDATE
- 위 두 가지가 발견되면 PR Reject

---

## ADR-005 — 상태 전이 시 자동 작업 생성 (Drizzle Hook + Idempotency)

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
SPEC §3.2의 자동 작업 생성 매트릭스를 안전하게 구현해야 한다. 무한 루프, 중복 생성, 누락이 모두 위험하다.

### 결정
- **트리거 위치**: 비즈니스 로직 레이어 (`src/lib/products/transition.ts`)
- **DB 트리거 사용 안 함** (애플리케이션에서 명시적으로 호출)
- **멱등성**: `(product_id, transition_from, transition_to, task_type)` 조합으로 unique key
- **실패 처리**: 작업 생성 실패해도 상태 전이는 커밋 (별도 알림)

### 이유
- DB 트리거는 디버그 어렵고, ORM 마이그레이션과 충돌
- 비즈니스 레이어에서 트랜잭션 안에 작업 생성을 묶음
- 멱등성 키로 동일 전이 재실행 시 중복 방지

### 결과
- `src/lib/products/transition.ts`에 단일 진입점 함수 `transitionProduct(productId, toStatus)`
- 단위 테스트 필수: 각 전이마다 자동 작업이 생성됨을 검증
- 멱등성 테스트: 같은 전이 2번 호출 시 작업 1건만 생성됨을 검증

### 위반 시
- ❌ DB 트리거로 작업 생성
- ❌ 멱등성 키 없이 작업 생성

---

## ADR-006 — BW Rank API는 서버 프록시 (`/api/bwrank/*`)를 통해서만 호출

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
BW Rank API(`api.bw-rank.kr`)는 인증이 없는 자체 인프라다. 클라이언트에서 직접 호출하면:
1. 사용량 통제 불가
2. CORS 문제
3. 캐싱 어려움
4. 임의 호출 가능 (보안)

### 결정
- 모든 BW Rank 호출은 **서버 사이드 (`app/api/bwrank/*`)** 를 통해서만
- 클라이언트는 자체 API만 호출
- 환경변수 `BWRANK_BASE_URL`로 URL 관리 (소스에 노출 금지)
- 응답은 Supabase에 캐싱 (6시간 TTL)
- 실패 시 폴백: 수동 입력 모드

### 이유
- 서버 프록시로 사용량 제어 + 캐싱 + 인증 게이팅
- 환경변수로 개발/스테이징/프로덕션 분리

### 결과
- `app/api/bwrank/product-score/route.ts`
- `app/api/bwrank/coupang-search/route.ts`
- `app/api/bwrank/stock-sales/route.ts`
- `app/api/bwrank/brand-sales/route.ts`
- `app/api/bwrank/traffic-check/route.ts`

### 위반 시
- ❌ 클라이언트 코드에서 `fetch('https://api.bw-rank.kr/...')`
- ❌ `BWRANK_BASE_URL`을 `NEXT_PUBLIC_*`로 노출

---

## ADR-007 — Claude 추정값은 🟡 표시 강제, 사용자 확정 전 차단

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
마진율, 단가, 시장 점유율 등은 Claude API로 추정한다. 추정값을 확정값처럼 표시하면 의사결정 오류가 발생한다.

### 결정
- Claude로 생성된 모든 숫자는 `confidence` 필드를 가진다 (`confirmed` / `estimated` / `unknown`)
- UI에서 `estimated`는 **🟡 마크 + 툴팁(추정 사유)** 강제 표시
- 마진율, 단가는 사용자 확정(`confirmedAt`) 전까지 회계 계산에 사용 금지
- DB 컬럼: `*_confidence` (예: `cogs_cny_confidence`, `margin_rate_confidence`)

### 이유
- 헌법 7대 금지 중 "할루시네이션 금지"
- 사용자가 명확한 신뢰도 정보 없이 의사결정하지 않도록

### 결과
- `src/lib/confidence.tsx`에 `<ConfidenceBadge>` 컴포넌트
- `src/lib/ai/margin-estimator.ts`는 항상 `{ value, confidence: 'estimated', reason: '...' }` 반환
- 추정값을 `confirmed`로 raw 캐스팅 시 lint 에러

### 위반 시
- ❌ 추정값을 표시할 때 🟡 마크 누락
- ❌ 추정값을 회계 계산에 직접 사용

---

## ADR-008 — 쿠팡 진입 난이도는 1페이지 36개 리뷰 분포 기반 자동 판정

**상태**: Accepted
**날짜**: 2026-04-07
**근거**: BUYWISE 기획서 (Python 전신, `naver-keyword정환` 폴더)

### 배경
키워드의 진입 난이도를 사람이 매번 판단하면 일관성이 없다.

### 결정
- 쿠팡 1페이지 36개 상품의 리뷰 수를 수집 (`coupang-api.zpost.shop`)
- 다음 규칙으로 자동 판정:

| 조건 | 결과 |
|---|---|
| 리뷰 <300 비율 ≥ 50% | **쉬움 (easy)** |
| 리뷰 <500 비율 ≥ 70% | **중간 (medium)** |
| 그 외 | **어려움 (hard)** |

- 결과는 `coupang_review_snapshots` 테이블에 6시간 캐싱
- UI에서 판정 근거(분포 차트 + 36개 상품 리스트) 항상 표시

### 이유
- BUYWISE 기획서에서 검증된 휴리스틱
- 리뷰가 적은 상품이 1페이지에 많을수록 신규 진입 가능성이 높음
- 명확한 규칙 → 사용자 신뢰도 ↑

### 결과
- `src/lib/research/difficulty.ts` — `calculateDifficulty(reviews: number[])`
- 단위 테스트 필수: 경계값 (50%, 70%) 정확성 검증
- 규칙 변경 시 새 ADR 추가

### 위반 시
- ❌ 임의 점수 부여 (예: "느낌상 어려움")
- ❌ 분포 데이터 없이 난이도 표시

---

## ADR-009 — 광고 예산 캡 + ROAS 임계 알림

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
쿠팡 광고는 수동 운영 시 예산 초과 위험이 크다. 자동 알림이 필수.

### 결정
- 모든 광고 캠페인은 `daily_budget_cap` 필수
- 일별 누적 소진이 90% 도달 시 알림
- ROAS < `roas_threshold` (기본 3.5) 도달 시 알림 + `ad_keyword_bid_adjust` 작업 자동 생성
- 매일 09:00 BW Rank로 ROAS 폴링 (Vercel Cron)

### 이유
- 광고비 폭주는 즉각적 손실
- 사람이 매일 확인하는 것은 비효율

### 결과
- `app/api/cron/ad-roas-check/route.ts`
- `vercel.json`에 cron 등록
- 알림은 `notifications` 테이블 + 이메일

---

## ADR-010 — 작업/상품 변경 이력은 Immutable Audit Log

**상태**: Accepted
**날짜**: 2026-04-07

### 배경
멀티 사용자 환경에서 누가 언제 무엇을 변경했는지 추적 가능해야 한다.

### 결정
- `tasks`, `products`의 모든 UPDATE는 별도 이력 테이블에 INSERT (`task_history`, `product_state_history`)
- 이력 테이블은 **읽기 전용** (UPDATE/DELETE 금지, RLS로 차단)
- 이력 컬럼: `id`, `entity_id`, `field`, `old_value`, `new_value`, `changed_by`, `changed_at`

### 이유
- 책임 추적 가능
- 디버그/감사 시 필수
- 멀티테넌트 환경에서 신뢰 확보

### 결과
- `src/lib/db/audit.ts` 헬퍼 함수 `recordChange()`
- 모든 비즈니스 mutation은 `recordChange()` 호출 강제 (lint 룰)
- 이력 테이블에 `company_id` 컬럼 + RLS

### 위반 시
- ❌ 이력 기록 없이 비즈니스 데이터 UPDATE
- ❌ 이력 테이블 UPDATE/DELETE 시도

---

## ADR-011 — InfoHub MCP를 외부 정보 수집 인프라로 활용 (형제 프로젝트 계약)

**상태**: Accepted
**날짜**: 2026-04-07
**관련**: `C:/개발/정보취합-2/CLAUDE.md` (InfoHub 헌법 P-5), `C:/개발/정보취합-2/mcp-server/index.ts`

### 배경
BUYWISE의 6단계 파이프라인 중 Research(트렌드/시장 조사), Sourcing(공급사 평판), Marketing(SEO/광고 인사이트), Branding(브랜드 멘션) 단계에서 외부 정보 수집이 필요하다.

선택지는 두 가지였다:
1. ecommerce-hub 안에 자체 크롤러/검색 API를 구현 (YouTube, Naver, Google 등 수십 개)
2. 형제 프로젝트 **InfoHub** (`정보취합-2`)에 이미 구축된 MCP 서버를 재사용

InfoHub는 28개 소스(youtube, naver_blog, naver_news, naver_cafe, google, perplexity, hackernews, arxiv, producthunt, github, hashnode, stackoverflow, devto, geeknews, lobsters, blackhatworld, instagram, huggingface, medium, velog, naver-d2, kakao-tech, yozm-it, neuron, tldr, okky, superhuman, rss)에 대한 수집·분석·지식 추출 파이프라인을 갖춘 인프라이며, "InfoHub는 인프라다 — 형제 프로젝트가 MCP를 통해 InfoHub의 지식을 읽는다"고 InfoHub CLAUDE.md에 명시되어 있다 ✅.

### 결정
- ecommerce-hub는 InfoHub MCP 서버의 **소비자(consumer)** 역할
- 직접 호출은 두 가지 모드 지원:
  - **모드 A (개발 시간)**: Claude Code 세션에서 `mcp__infohub__infohub_*` 도구 직접 호출 → 개발자가 키워드 리서치, 시장 조사, 경쟁사 분석에 사용
  - **모드 B (런타임, Phase 2)**: ecommerce-hub Next.js 앱이 InfoHub REST API를 서버 사이드에서 호출 (`/api/research/infohub-fetch`)
- **Phase 1 MVP는 모드 A만**. 모드 B는 Phase 2에서 도입 (CPS Phase 2 항목)
- InfoHub MCP가 노출하는 6개 도구 사용:
  - `infohub_topics` — 토픽 목록 조회
  - `infohub_collect` — 키워드 → 외부 소스 수집 (한↔영 자동 번역)
  - `infohub_search` — 수집된 아이템 검색
  - `infohub_knowledge` — AI 분석된 지식 카드 조회
  - `infohub_analyze` — 미분석 아이템 AI 분석 트리거
  - `infohub_export` — markdown/csv/json 내보내기

### 형제 프로젝트 계약 (Brother Project Contract)
- **InfoHub 응답 스키마는 불변 계약**이다. 우리(ecommerce-hub)가 의존하는 필드를 InfoHub에서 변경/삭제하면 우리가 깨진다
- 우리가 사용하는 InfoHub 필드는 `docs/INFOHUB_INTEGRATION.md` §"의존 필드 목록"에 명시
- InfoHub 측 P-5(MCP 응답 스키마 무단 변경 금지)와 우리 측 ADR-011은 양방향 계약
- InfoHub 응답이 깨지면 ecommerce-hub는 **빈 결과 반환 금지** → 명시적 에러 throw + UI에 ❓ unknown 표시 (P-1, P-3 준수)

### 신뢰도 마킹 규칙
- InfoHub에서 가져온 모든 데이터는 **기본값 🟡 estimated** (ADR-007)
- 출처 컬럼 강제: `source: 'infohub:naver_blog' | 'infohub:youtube' | ...`
- 수집 시각 강제: `fetched_at` (TTL 6시간 — 그 이상은 ❓ unknown으로 다운그레이드)
- 사용자가 InfoHub 데이터를 보고 직접 입력한 값만 ✅ confirmed로 승급 가능

### 호출 시점 매트릭스
| BUYWISE 단계 | InfoHub 함수 | 키워드 예시 | 사용 목적 |
|---|---|---|---|
| Research | `infohub_collect` + `infohub_knowledge` | "나노 코팅 트렌드" | 시장 동향 + 경쟁 제품 발굴 |
| Sourcing | `infohub_search` (source=google,perplexity) | "LongRich 제조사 평판" | 공급사 신뢰도 조사 |
| Listing | `infohub_knowledge` | "쿠팡 SEO 2026" | 상품명 카피라이팅 노하우 |
| Marketing | `infohub_collect` (source=youtube,naver_blog) | "쿠팡 광고 ROAS 개선" | 광고 운영 인사이트 |
| Branding | `infohub_collect` | "유어밸류 농산물" | 자사 브랜드 멘션 모니터링 |

### 이유
- DRY: 28개 소스 크롤러를 다시 만들지 않음 → 개발 시간 ~8주 절감 🟡 (InfoHub 기존 자산 기준 추정)
- 단일 책임: ecommerce-hub는 비즈니스 로직, InfoHub는 정보 수집 → 변경 충격 격리
- 한↔영 자동 번역, AI 지식 추출 등 InfoHub의 부가가치 무료 활용
- 형제 프로젝트 계약으로 책임 경계가 명확

### 대안 검토
- **자체 크롤러 구현**: 8주 추가 개발 + 유지보수 부담 → 기각
- **외부 SaaS (Brandwatch, Mention.com)**: 월 $300+, 한국 소스 약함 → 기각
- **Apify/Bright Data 직접 통합**: 가능하지만 InfoHub가 이미 래핑함 → 중복 → 기각

### 결과
- `docs/INFOHUB_INTEGRATION.md` 신규 생성 (의존 필드, 호출 패턴, 에러 처리)
- `agents/infohub.md` 신규 생성 (Claude 세션에서 InfoHub 호출 시 SOP)
- `.env.local.example`에 `INFOHUB_URL`, `INFOHUB_AUTH_TOKEN` 추가 (Phase 2 모드 B 대비)
- DB 스키마 추가 (Phase 2): `keyword_research_snapshots` 테이블에 `source: 'infohub:*'` 컬럼

### 위반 시
- ❌ InfoHub 응답 필드를 검증 없이 사용 (스키마 깨지면 런타임 크래시)
- ❌ InfoHub 데이터를 ✅ confirmed로 표시 (P-3 위반)
- ❌ InfoHub 다운 시 빈 배열 반환 (P-1 위반 — 명시적 에러 throw)
- ❌ InfoHub 응답 스키마를 ecommerce-hub 측에서 임의 가정 (실제 응답 Read 후 사용)

---

## 부록 A — ADR 작성 규칙

새 ADR 추가 시:
1. 다음 번호로 작성 (`ADR-011` ...)
2. 상태: `Proposed` → `Accepted` → `Superseded` / `Deprecated`
3. 이전 ADR을 대체하는 경우 `Supersedes ADR-XXX` 명시
4. 충돌 시 새 ADR이 우선
5. 코드 변경 PR과 동시에 ADR 추가

## 부록 B — ADR 결정 우선순위

1. **CPS** (왜 만드는가)
2. **SPEC** (무엇을 만드는가)
3. **ADR** (어떻게 만드는가)
4. 코드

상위 문서와 충돌 시 항상 상위가 이긴다.

---

## 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (ADR-001 ~ ADR-010) |
| 1.1 | 2026-04-07 | 이재홍 | ADR-011 추가 (InfoHub MCP 형제 프로젝트 계약) |
