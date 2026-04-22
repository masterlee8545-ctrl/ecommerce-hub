# 울트라플랜 프롬프트 — BUYWISE 이커머스 통합관리 시스템

아래 프롬프트를 `/ultraplan` 실행 시 입력하세요.

---

## 프롬프트 (여기부터 복사)

```
BUYWISE 이커머스 통합관리 시스템의 나머지 60%를 완성해야 합니다.

## 프로젝트 개요
한국 국내 수입 대행업체를 위한 멀티테넌트 SaaS.
6단계 상품 파이프라인: Research → Sourcing → Importing → Listing → Active → Branding.
스택: Next.js 15 App Router, TypeScript (strict), Drizzle ORM, PostgreSQL (Supabase), Tailwind CSS.

## 현재 완성된 것 (약 40%)
- 인증/로그인 (NextAuth v5, 멀티테넌트)
- 상품 CRUD + 6단계 파이프라인 전환
- Research: 쿠팡 리뷰 분석, 트렌드 페이지
- Sourcing: 공급사 관리, 견적 CRUD/엑셀 임포트/비교, 상태 전환
- Importing: 대시보드 + 리드타임 경고
- Task 관리 시스템 (작업 CRUD, 인라인 상태 전환)
- 알림 시스템
- 테스트 262개 통과, gc(lint+typecheck+test+build) 통과

## 아직 구현 안 된 것 (약 60%)
DB 스키마와 SPEC은 전부 정의되어 있지만 UI/비즈니스 로직이 없는 영역입니다:

### [우선순위 1] Importing 단계 완성
- purchase_orders (발주서) CRUD — 스키마: purchase_orders 테이블 이미 존재
  - 발주서 생성/수정/상태 전환 (pending → paid → shipped → customs → received)
  - 환율 입력, 관세 계산 (tariff_presets 테이블 활용), 배송비 포함 최종 원가
  - 물류 추적 UI (현재 상태 + 예상 도착일)
- 견적 확정(acceptQuote) 시 purchase_order 자동 생성 연결

### [우선순위 2] Listing 단계 신규
- /listing 라우트 생성 — 스키마: listings 테이블 이미 존재
  - 플랫폼별 상품 등록 관리 (쿠팡/네이버 스마트스토어/11번가)
  - 등록 상태 추적 (draft → pending_review → active → paused)
  - 상품 → 리스팅 1:N 관계 (한 상품이 여러 플랫폼에 등록)
- importing → listing 전환 시 자동 작업 4종 생성:
  1. 상세페이지 디자인 (박지연)
  2. 상품 촬영 (김민수)
  3. SEO 키워드 선정 (이재홍)
  4. 광고 캠페인 기획 (이재홍)

### [우선순위 3] Active 단계 (마케팅/광고/SEO)
- /marketing 라우트 — 스키마: ad_campaigns, ad_groups, ad_keywords, ad_metrics 이미 존재
  - 광고 캠페인 CRUD
  - 키워드별 입찰가 관리
  - 일일 ROAS 추적 + ROAS < 3.5 시 자동 알림 (ADR-009)
  - 일일 예산 상한 강제 (daily_budget_cap_krw NOT NULL)
- /seo 라우트 — 스키마: seo_targets, keyword_rankings 이미 존재
  - SEO 타겟 키워드 등록
  - 키워드 순위 시계열 추적
  - 순위 5단계 이상 하락 시 자동 알림
- listing → active 전환 시 자동 작업: 키워드 순위 모니터링 + 광고 예산 검토

### [우선순위 4] 대시보드 강화
- 메인 대시보드 (/) 를 실질적인 현황판으로:
  - 6단계 파이프라인별 상품 수 카운트 + 클릭 시 필터링
  - 오늘 할 일 (내 미완료 작업 Top 5)
  - 경고 패널 (리드타임 초과, ROAS 하락, 순위 하락)
  - 최근 상태 전환 히스토리

### [우선순위 5] Branding 단계
- /branding 라우트 — 현재 스키마 없음 (신규 테이블 필요할 수 있음)
  - 자체 브랜드 전환 관리
  - 패키지 디자인, 브랜드 스토어 기획
  - 이 단계는 Phase 2로 미뤄도 됨

### [우선순위 6] 자동 작업 생성 엔진 완성
- SPEC §6에 정의된 15종 자동 작업 중 현재 구현된 것: importing 전환 시 1종만
- 나머지 14종:
  - listing 전환 시 4종 (디자인/촬영/SEO/광고)
  - active 전환 시 2종 (순위 모니터링/예산 검토)
  - ROAS < 3.5 시 1종 (입찰 조정)
  - 순위 하락 시 1종 (SEO 리뷰)
  - 재고 부족 시 1종 (재발주 결정)
  - PO ETA 초과 시 1종 (통관 에스컬레이션)
  - 기타 4종

## 아키텍처 규칙 (반드시 준수)
1. 멀티테넌트: 모든 쿼리에 company_id 필터 (withCompanyContext 헬퍼 사용)
2. 서버 액션: 'use server' + requireCompanyContext() + revalidatePath fan-out
3. 에러 처리: 빈 배열 은폐 금지 → 명시적 throw (P-1, P-2)
4. 신뢰도 마킹: 외부/추정 데이터에 confirmed/estimated/unknown 표시 (P-3)
5. TypeScript strict: exactOptionalPropertyTypes + noUncheckedIndexedAccess
6. 테스트: 모든 도메인 함수에 입력 검증 단위 테스트
7. 자동 작업: 멱등성 키로 중복 방지 (ADR-005)
8. 감사 로그: product_state_history, task_history는 INSERT only (ADR-010)

## 기존 패턴 참조
- 도메인 함수 패턴: src/lib/sourcing/quotes.ts (검증 → withCompanyContext → 쿼리)
- 서버 액션 패턴: src/lib/sourcing/actions.ts (FormData 파싱 → 검증 → 도메인 함수 → revalidate)
- 페이지 패턴: src/app/(app)/sourcing/quotes/page.tsx (Server Component, parallel queries)
- 테스트 패턴: src/lib/sourcing/quotes.test.ts (DB 호출 전 검증 단계만 테스트)
- 대시보드 패턴: src/app/(app)/importing/page.tsx (parallel queries → in-memory join → 카드 그리드)

## 요청
위 우선순위 순서대로 구현 계획을 세워주세요.
각 우선순위별로:
1. 필요한 파일 목록 (신규/수정)
2. 의존 관계 (어떤 것이 먼저여야 하는지)
3. 리스크/주의 사항
4. 예상 작업 단위 (작은 PR로 나눌 수 있는 단위)

특히 "자동 작업 생성 엔진"은 모든 단계에 걸쳐 있으므로 별도 모듈로 설계해주세요.
```

---

## 실행 방법

터미널에서:

```bash
cd C:\개발\ecommerce-hub
claude --dangerously-skip-permissions
```

Claude Code 실행 후:

```
/ultraplan
```

그러면 "Enter your task" 프롬프트가 나옵니다.
위 프롬프트(``` 안의 내용)를 붙여넣으세요.

울트라플랜이 클라우드에서 분석을 시작하고,
완료되면 브라우저에서 계획서를 확인할 수 있습니다.
