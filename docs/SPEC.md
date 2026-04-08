# SPEC — Product Specification (제품 사양서)

> 이 문서는 "무엇을 만드는가"의 단일 근거다.
> CPS와 충돌 시 CPS가 우선한다.
> 이 문서에 없는 기능은 만들지 않는다 (스코프 크리프 방지).

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 관련 문서 | CPS.md, ADR.md, DATA_MODEL.md |

---

## 1. 시스템 개요

### 1.1 한 줄 정의
**한국 이커머스 6단계 파이프라인 통합 관리 시스템 (멀티테넌트 SaaS)**

### 1.2 기술 스택

| 영역 | 선택 | 이유 (상세는 ADR 참조) |
|---|---|---|
| 프레임워크 | Next.js 15 (App Router) + TypeScript | ADR-001 |
| DB | Supabase (PostgreSQL) | ADR-002 |
| ORM | Drizzle ORM | ADR-002 |
| UI | shadcn/ui + Tailwind CSS | ADR-003 |
| 폰트 | Pretendard Variable | ADR-003 |
| 차트 | Recharts | ADR-003 |
| 인증 | NextAuth.js v5 + Supabase | ADR-004 |
| 배포 | Vercel | ADR-001 |
| AI | Anthropic Claude API | ADR-007 |

### 1.3 외부 통합

| API | 용도 | 인증 | 상세 |
|---|---|---|---|
| **BW Rank API** (`api.bw-rank.kr`) | 키워드 순위, 매출 추정, 트래픽 | 없음 (자체 인프라) | ADR-006 |
| **쿠팡 리뷰 API** (`coupang-api.zpost.shop`) | 1페이지 상품 36개 리뷰 수집 | 없음 | ADR-008 |
| **네이버 데이터랩 API** | 월 검색량 트렌드 | OAuth | (Phase 2) |
| **Anthropic Claude API** | 마진 추정, 키워드 분석 보조 | API Key | ADR-007 |

---

## 2. 사용자 권한 모델

### 2.1 권한 등급

| 등급 | 권한 | 제한 |
|---|---|---|
| **owner** | 모든 기능 + 회사 설정 + 사용자 초대 | 자신의 회사만 |
| **manager** | CRUD + 작업 배정 + 광고 운영 | 자신의 회사만 |
| **operator** | 작업 수행 + 자신에게 배정된 작업만 변경 | 자신의 회사만 |

### 2.2 회사 접근 (Multi-tenant)

- 한 사용자(`user`)는 여러 회사(`company`)에 속할 수 있다 (`user_companies` 다대다 테이블).
- 사용자 등급은 **회사별로 다를 수 있다** (예: 바이와이즈에서는 owner, 유어밸류에서는 operator).
- 모든 비즈니스 테이블에는 `company_id` 컬럼이 있고, Supabase RLS로 강제 분리.
- 사용자가 회사를 전환하면 모든 화면이 해당 회사 데이터로 갱신.

---

## 3. 6단계 파이프라인 사양

### 3.1 상태 정의

```
┌──────────┐    ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ research │ →  │ sourcing│ →  │ importing │ →  │ listing  │ →  │  active  │ →  │ branding │
│  ① 리서치 │    │  ② 소싱 │    │ ③ 수입중   │    │  ④ 등록  │    │ ⑤ 판매중  │    │ ⑥ 브랜딩 │
└──────────┘    └─────────┘    └───────────┘    └──────────┘    └──────────┘    └──────────┘
```

| 상태 | 의미 | 진입 조건 | 진출 조건 |
|---|---|---|---|
| `research` | 키워드 분석, 시장 조사 단계 | 신규 등록 | 소싱 결정 시 |
| `sourcing` | 1688 견적 요청 ~ 발주 확정 | 키워드 채택 | 발주 결제 시 |
| `importing` | 제품 생산 ~ 통관 ~ 입고 | 발주 결제 완료 | 입고 완료 시 |
| `active` (판매중) | 광고/SEO/리뷰 운영 | 등록 완료 + 광고 캠페인 활성 | 판매 종료 결정 시 |
| `branding` | 자체 브랜드 스토어 기획 | 매출/리뷰 임계 도달 | 브랜드 전환 완료 |

### 3.2 상태 전이 자동 작업 매트릭스

| 전이 | 자동 생성 작업 (`task_type`) | 담당자 룰 |
|---|---|---|
| `research → sourcing` | `quote_request_1688` | 소싱 담당 |
| `sourcing → importing` | `payment_confirm`, `customs_track` | 소싱 담당 |
| `importing → listing` | `detail_page_design`, `product_photo`, `seo_keyword_setup`, `ad_campaign_create` | 디자이너 / 촬영 / 마케팅 |
| `listing → active` | `keyword_rank_monitor`, `ad_budget_review` | 마케팅 |
| `active → branding` | `brand_store_design` | 디자이너 |

**구현 요점:**
- 상태 전이는 `products.status` 컬럼 업데이트 시 트리거 (Drizzle hook)
- 작업 생성은 **멱등(idempotent)** — 동일 전이로 같은 작업 중복 생성 금지
- 작업 자동 생성 실패 시 상태 전이를 롤백하지 않고 **알림 + 재시도 큐**에 등록

---

## 4. 화면 사양 (Page Inventory)

총 **38개 페이지** (Next.js App Router 기준).

### 4.1 인증 (3개)
- `/login` — 로그인
- `/register` — 회원가입 (초대 토큰 필수)
- `/forgot` — 비밀번호 재설정

### 4.2 대시보드 (1개)
- `/` — 메인 대시보드 (KPI, 파이프라인 시각화, 활동 피드, 내 작업)

### 4.3 ① 리서치 (4개)
- `/research` — 키워드 분석 목록 + 신규 분석
- `/research/[keyword]` — 키워드 상세 (BW Rank 결과)
- `/research/[keyword]/coupang` — **쿠팡 1페이지 리뷰 분석 (핵심 화면)**
- `/research/calculator` — 마진 계산기

### 4.4 ② 소싱 (5개)
- `/sourcing` — 진행 중 견적/발주 목록
- `/sourcing/quotes/new` — 견적 요청 작성
- `/sourcing/quotes/[id]` — 견적 상세
- `/sourcing/orders` — 발주 목록
- `/sourcing/orders/[id]` — 발주 상세 (통관/배송 추적)

### 4.5 ③ 상품 관리 (4개)
- `/products` — 상품 목록 (필터: 상태, 카테고리, 담당자)
- `/products/new` — 상품 등록
- `/products/[id]` — **상품 상세 (라이프사이클 + 자동 작업 알림 + 탭)**
- `/products/[id]/edit` — 상품 정보 수정

### 4.6 ④ 플랫폼 등록 (3개)
- `/listings` — 등록 진행 상황
- `/listings/[id]/coupang` — 쿠팡 윙 등록 데이터
- `/listings/[id]/naver` — 네이버 스마트스토어 등록 데이터

### 4.7 ⑤ 마케팅 (광고) (5개)
- `/marketing` — 광고 대시보드 (총 ROAS, 캠페인 목록)
- `/marketing/campaigns` — 캠페인 목록
- `/marketing/campaigns/new` — 캠페인 생성
- `/marketing/campaigns/[id]` — 캠페인 상세 (광고 그룹, 키워드, 성과)
- `/marketing/keywords` — 광고 키워드 입찰 관리

### 4.8 ⑥ 상위노출 / SEO (3개)
- `/seo` — SEO 대시보드 (추적 키워드, 평균 순위)
- `/seo/keywords` — 키워드 순위 목록
- `/seo/keywords/[id]` — 키워드 상세 (순위 추이 차트)

### 4.9 ⑦ 판매/매출 (4개)
- `/sales` — 판매 대시보드 (실시간 매출, 일별/월별)
- `/sales/orders` — 주문 목록
- `/sales/settlements` — 정산 목록
- `/sales/settlements/[id]` — 정산서 상세

### 4.10 작업 보드 (2개)
- `/tasks` — 칸반 보드 (대기/진행중/검토/완료)
- `/tasks/[id]` — 작업 상세

### 4.11 팀 (2개)
- `/team` — 팀원 목록
- `/team/invite` — 사용자 초대

### 4.12 설정 (2개)
- `/settings/company` — 회사 정보
- `/settings/integrations` — API 연동 (BW Rank, Coupang, Naver)

---

## 5. 핵심 사용자 시나리오

### S-001 — 신규 키워드 분석부터 소싱 결정까지
1. 이재홍이 `/research`에서 "휴대용 선풍기" 분석 시작
2. 시스템이 BW Rank API로 월 검색량 조회 → 결과 표시
3. 시스템이 쿠팡 리뷰 API로 1페이지 36개 상품의 리뷰수 수집
4. **자동 난이도 판정**: 리뷰 <300 비율 = 61.1% → "쉬움"
5. 이재홍이 "⭐ 추천 → 소싱" 버튼 클릭
6. 시스템이 `products` 테이블에 새 행 생성 (`status='research'`)
7. 시스템이 자동으로 `quote_request_1688` 작업을 박지연에게 배정

**검증:**
- 리뷰 분석 < 30초
- 신뢰도 표시 누락 0
- 작업 자동 생성 0 누락

### S-002 — 발주 확정 후 등록 단계 진입
1. 박지연이 `/sourcing/orders/[id]`에서 1688 결제 완료 표시
2. 시스템이 상품 상태를 `sourcing → importing`으로 전이
3. 자동 작업 생성: `customs_track`, `payment_confirm` (박지연에게)
4. 통관 완료 후 박지연이 "입고 확인" 버튼 클릭
5. 시스템이 상태를 `importing → listing`으로 전이
6. **자동 작업 4건 생성:**
   - 상세페이지 디자인 → 박지연 (D-3)
   - 상품 촬영 → 김민수 (D-2)
   - SEO 키워드 등록 → 이재홍 (D-1)
   - 광고 캠페인 생성 → 이재홍 (D-1)
7. 각 담당자에게 알림 발송

### S-003 — ROAS 하락 알림
1. 시스템이 매일 09:00 광고 캠페인 ROAS를 BW Rank로 조회
2. ROAS가 임계값(3.5x) 미만으로 하락하면 알림 생성
3. `/dashboard`에 빨간 카드 + 상단 알림 벨에 표시
4. 자동 작업 생성: `ad_keyword_bid_adjust` → 이재홍 (긴급)

---

## 6. 자동화 트리거 매트릭스

| 트리거 | 조건 | 동작 |
|---|---|---|
| 상태 전이 | `products.status` 변경 | 매트릭스 §3.2의 작업 자동 생성 |
| ROAS 임계 미달 | `ad_metrics.roas < 3.5` | `ad_keyword_bid_adjust` 작업 + 알림 |
| 키워드 순위 하락 | `keyword_rankings.delta_3d > 5` | `seo_review` 작업 + 알림 |
| 재고 임계 미달 | `inventory.qty < threshold` | `restock_decision` 작업 |
| 발주 입고 지연 | `purchase_orders.eta_overdue` | `customs_escalate` 작업 |
| 작업 마감 1일 전 | `tasks.due_at - now < 1d` | 알림 (담당자) |
| 작업 마감 초과 | `tasks.due_at < now` | 긴급 알림 (담당자 + 매니저) |

---

## 7. 사람 작업 카탈로그 (Task Types)

총 **15종**. 자동 생성 시 시스템이 `task_type`을 사용해 담당자/마감/제목 결정.

| 코드 | 카테고리 | 제목 | 기본 담당 | 기본 D-day | 자동 생성 트리거 |
|---|---|---|---|---|---|
| `quote_request_1688` | 소싱 | 1688 견적 의뢰 | 소싱 담당 | D-5 | 키워드 채택 |
| `payment_confirm` | 소싱 | 발주 결제 확정 | 매니저 | D-2 | 견적 확정 |
| `customs_track` | 소싱 | 통관/배송 추적 | 소싱 담당 | 상시 | 결제 완료 |
| `detail_page_design` | 디자인 | 상세페이지 디자인 | 디자이너 | D-3 | 입고 완료 |
| `product_photo` | 촬영 | 상품 촬영 | 촬영 담당 | D-2 | 입고 완료 |
| `seo_keyword_setup` | SEO | SEO 키워드 등록 | 마케팅 | D-1 | 입고 완료 |
| `ad_campaign_create` | 광고 | 쿠팡 광고 캠페인 생성 | 마케팅 | D-1 | 입고 완료 |
| `keyword_rank_monitor` | SEO | 키워드 순위 모니터링 | 마케팅 | 상시 | 등록 완료 |
| `ad_budget_review` | 광고 | 광고 예산 검토 | 마케팅 | 주간 | 등록 완료 |
| `ad_keyword_bid_adjust` | 광고 | 광고 키워드 입찰 조정 | 마케팅 | D-1 | ROAS 임계 미달 |
| `seo_review` | SEO | SEO 키워드 분석 재검토 | 마케팅 | D-2 | 순위 급락 |
| `restock_decision` | 운영 | 재고 보충 결정 | 매니저 | D-3 | 재고 임계 미달 |
| `customs_escalate` | 소싱 | 통관 지연 에스컬레이션 | 매니저 | D-1 | ETA 초과 |
| `settlement_review` | 운영 | 정산서 검토 | 매니저 | D-5 | 월말 |
| `brand_store_design` | 브랜딩 | 브랜드 스토어 기획 | 디자이너 | D-30 | 매출 임계 도달 |

---

## 8. 비기능 요구사항 (NFR)

### 8.1 성능
- 대시보드 로딩 < 1.5초 (3G 기준)
- 키워드 분석 (BW Rank + 쿠팡 리뷰) < 30초
- 상품 목록 50개 < 800ms
- 작업 보드 100개 < 1초

### 8.2 보안
- 모든 API 호출 인증 필수 (`/api/public/*` 제외)
- 회사 간 데이터 누출 차단 (RLS + 미들웨어)
- API 키는 절대 클라이언트 노출 금지
- 비밀번호 bcrypt cost ≥ 12

### 8.3 가용성
- Vercel 배포 (자동 멀티 리전)
- Supabase PITR (Point-In-Time Recovery)
- 일일 백업 (30일 보관)

### 8.4 접근성
- 키보드 네비게이션 100%
- 색상 대비 WCAG AA
- 다크 모드 대응

---

## 9. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (38 페이지 / 21 테이블 / 15 작업 종류) |
