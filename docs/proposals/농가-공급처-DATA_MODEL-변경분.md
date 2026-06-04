# DATA_MODEL.md 변경분 — 농가 공급처 찾기 기능

**Phase**: A (Planner)
**날짜**: 2026-05-13
**관련**: ADR-012, ADR-013, docs/DATA_MODEL.md

> 이 문서는 `docs/DATA_MODEL.md` 에 적용할 패치 명세다.
> Phase B 1번 PR 시작 시 본 문서에 머지된다.

---

## 변경 요약

| 항목 | 변경 | 적용 PR |
|---|---|---|
| `vendors` 테이블 | **신규** | 1번 PR |
| `vendor_products` 테이블 | **신규** | 1번 PR |
| `vendor_call_logs` 테이블 | **신규** | 1번 PR (스키마) / 3번 PR (활용) |
| `product_vendor_candidates` 테이블 | **신규** | 1번 PR (스키마) / 2번 PR (활용) |
| `vendor_access_grants` 테이블 | **신규 (스키마만)** | 1번 PR (스키마) / 4번 PR (RLS + UI) |
| `products` 컬럼 추가 (6개) | **신규** | 1번 PR (마이그레이션) / 5번 PR (시즌 메타 채움) |
| 테이블 총 개수 | 21 → **26** | - |

---

## §1 테이블 카탈로그 갱신

기존 §1 의 "그룹 B — 파이프라인 (8개)" 을 다음과 같이 변경:

### 그룹 B — 파이프라인 (13개) [기존 8개 + 신규 5개]

| # | 테이블 | 설명 | 상태 |
|---|---|---|---|
| 4 | `products` | 상품 (라이프사이클) | 기존 (컬럼 6개 추가) |
| 5 | `product_state_history` | 상품 상태 이력 | 기존 |
| 6 | `keywords` | 분석한 키워드 | 기존 |
| 7 | `coupang_review_snapshots` | 쿠팡 리뷰 분석 | 기존 |
| 8 | `suppliers` | 공급자 (1688) | 기존 (변경 없음) |
| 9 | `quotes` | 견적 | 기존 |
| 10 | `purchase_orders` | 발주 | 기존 |
| 11 | `listings` | 플랫폼 등록 | 기존 |
| **12** | **`vendors`** | **국내 농가/공장 마스터** | **신규** |
| **13** | **`vendor_products`** | **농가 ↔ 취급 품목 다대다** | **신규** |
| **14** | **`vendor_call_logs`** | **농가 통화/카톡/방문 기록 (immutable)** | **신규** |
| **15** | **`product_vendor_candidates`** | **상품 ↔ 농가 공급처 후보** | **신규** |
| **16** | **`vendor_access_grants`** | **농가 풀 공유 승인** | **신규** |

**테이블 총 개수**: 21 → **26**

---

## §3.1 `products` 테이블 — 컬럼 추가 (6개)

기존 컬럼 유지 + 다음 6개 nullable 컬럼 추가:

```typescript
// src/db/schema/products.ts (변경 패치)

export const products = pgTable('products', {
  // ... 기존 컬럼 유지 ...

  // ─── 공급망 분기 (ADR-012) ───
  supply_type: text('supply_type'),
    // 'domestic_vendor' | 'overseas_supplier' | 'both' | NULL
    // NULL = 사용자가 아직 결정 안 함 (탭 둘 다 노출)
  primary_vendor_id: uuid('primary_vendor_id')
    .references(() => vendors.id),
    // 국내 농가 공급처 (확정된 경우)
    // 기존 primary_supplier_id 와 별개 (의미 충돌 회피)

  // ─── 시즌 메타 (시즌 펄스 → 담기 시 자동 채움, ADR-012 D-5) ───
  season_peak_month: integer('season_peak_month'),
    // 1~12, 피크 검색 월
  season_prep_month: integer('season_prep_month'),
    // 1~12, 소싱 준비 시작 월
  seasonality_ratio: numeric('seasonality_ratio', { precision: 5, scale: 2 }),
    // 피크 / 바닥 6개월 평균 (예: 12.50배)
  season_score: integer('season_score'),
    // 시즌 펄스 5점 스코어링 결과 (5/4/2/1)
});
```

**제약**:
- `supply_type` CHECK 제약: `IN ('domestic_vendor', 'overseas_supplier', 'both') OR NULL`
- `season_peak_month`, `season_prep_month` CHECK: `BETWEEN 1 AND 12 OR NULL`
- `season_score` CHECK: `IN (1, 2, 4, 5) OR NULL`

**인덱스**:
```sql
CREATE INDEX idx_products_supply_type ON products(supply_type) WHERE supply_type IS NOT NULL;
CREATE INDEX idx_products_primary_vendor ON products(primary_vendor_id) WHERE primary_vendor_id IS NOT NULL;
CREATE INDEX idx_products_season_prep ON products(season_prep_month) WHERE season_prep_month IS NOT NULL;
```

---

## §3.9 `vendors` (국내 농가/공장 마스터) [신규]

```sql
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 (P-5)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- ─── 식별 ───
  slug text NOT NULL,                          -- 사이소 sellerId / jpsmall slug
  bizName text NOT NULL,                       -- 업체명
  bizNo text,                                  -- 사업자번호 (정규화 가능, 빈값/더미 NULL)
  bizNo_confidence text NOT NULL DEFAULT 'estimated',  -- P-3
                                                -- 'confirmed' | 'estimated' | 'unknown'

  -- ─── 대표 ───
  bizOwnerName text,                           -- 대표자명
  reprTelNo text,                              -- 대표 번호
  bizMobile text,                              -- 휴대전화
  contact_confidence text NOT NULL DEFAULT 'estimated',

  -- ─── 주소 ───
  bizAddress text,                             -- 합성 주소
  bizZip text,                                 -- 우편번호 (사이소만)

  -- ─── 업종 (사이소 데이터에 있음) ───
  bizType text,                                -- '제조' | '유통' | '사업자'
  bizSector text,                              -- 업종 텍스트 (예: '다류, 음료류')

  -- ─── 분류 (기존 jpsmall/nongasil 만 보유) ───
  classification text,                         -- '1차_농가' | '1차_법인' | '가공유통' | ...
  classification_basis text,                   -- 분류 근거 (사이소는 비어있음, 6번 PR에서 후처리)

  -- ─── 상품 정보 (요약) ───
  productCount integer DEFAULT 0,
  productKeywordsAll text,                     -- 콤마 구분
  productsTop10 text,                          -- JSON 또는 콤마 구분 텍스트

  -- ─── 출처 추적 ───
  source_site text NOT NULL,                   -- 마스터 row 의 출처 (예: '사이소-안동장터')
  also_listed_on text[] NOT NULL DEFAULT '{}', -- 부가 출처 (예: ['사이소-경주몰', '김제지평선몰'])
  source_url text,                             -- 원본 페이지 URL

  -- ─── 개인정보 (사이소만, ADR-013 D-4 RLS 마스킹) ───
  rpersBirthdt date,                           -- 생년월일 ⚠️
  rpersGender text,                            -- 성별 ⚠️

  -- ─── 소개 ───
  intro_html text,                             -- HTML 소개글 (사이소 sellerIntroCont)

  -- ─── 공통 ───
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),

  -- ─── 제약 ───
  CONSTRAINT vendors_company_slug_unique UNIQUE (company_id, slug),
  CONSTRAINT vendors_bizNo_confidence_check CHECK (bizNo_confidence IN ('confirmed', 'estimated', 'unknown')),
  CONSTRAINT vendors_contact_confidence_check CHECK (contact_confidence IN ('confirmed', 'estimated', 'unknown'))
);

CREATE INDEX idx_vendors_company ON vendors(company_id);
CREATE INDEX idx_vendors_biz_no ON vendors(bizNo) WHERE bizNo IS NOT NULL;
CREATE INDEX idx_vendors_biz_name ON vendors USING gin (to_tsvector('simple', bizName));
CREATE INDEX idx_vendors_source_site ON vendors(source_site);
CREATE INDEX idx_vendors_classification ON vendors(classification);

-- 1번 PR: 회사 격리 RLS 만
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_select_own" ON vendors
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());

CREATE POLICY "vendors_modify_own" ON vendors
  FOR ALL TO authenticated
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

GRANT ALL ON vendors TO service_role;

-- 4번 PR에서 SELECT 정책을 vendor_access_grants 기반으로 교체 (ADR-013 D-2)
```

---

## §3.10 `vendor_products` (농가 ↔ 취급 품목 다대다) [신규]

```sql
CREATE TABLE vendor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_keyword text NOT NULL,               -- 정규화된 품목 키워드 ('쌀', '한우', '참외' 등)

  -- 매칭 보강
  source text,                                 -- '사이소-productKeywordsAll' | '사용자-수동'
  confidence text NOT NULL DEFAULT 'estimated',

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vendor_products_unique UNIQUE (vendor_id, product_keyword)
);

CREATE INDEX idx_vendor_products_vendor ON vendor_products(vendor_id);
CREATE INDEX idx_vendor_products_keyword ON vendor_products(product_keyword);
CREATE INDEX idx_vendor_products_company ON vendor_products(company_id);

ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vp_select_own_or_via_vendor_grant" ON vendor_products
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
  -- 4번 PR에서 vendor_access_grants 조건 추가

CREATE POLICY "vp_modify_own" ON vendor_products
  FOR ALL TO authenticated
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
```

---

## §3.11 `vendor_call_logs` (통화 기록) [신규, immutable]

```sql
CREATE TABLE vendor_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 멀티테넌트 (P-5)
  company_id uuid NOT NULL REFERENCES companies(id),

  -- 대상
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  product_id uuid REFERENCES products(id),     -- 어느 상품 때문에 통화했는지 (nullable)

  -- 통화 내용
  channel text NOT NULL,                       -- 'phone' | 'kakao' | 'visit' | 'other'
  result text NOT NULL,                        -- '연결됨' | '부재중' | '거절' | '견본_요청' | '거래_시작' | '탈락'
  notes text,                                  -- 자유 텍스트 메모

  -- 후속 액션
  next_action text,                            -- '재통화' | '견본_대기' | '계약_검토' | NULL
  next_action_at timestamptz,                  -- 후속 액션 마감

  -- 통화자
  called_by_user_id uuid NOT NULL REFERENCES users(id),
  called_at timestamptz NOT NULL DEFAULT now(),

  -- ─── 제약 ───
  CONSTRAINT vendor_call_logs_channel_check CHECK (channel IN ('phone', 'kakao', 'visit', 'other')),
  CONSTRAINT vendor_call_logs_result_check CHECK (result IN ('연결됨', '부재중', '거절', '견본_요청', '거래_시작', '탈락'))
);

CREATE INDEX idx_vcl_vendor ON vendor_call_logs(vendor_id);
CREATE INDEX idx_vcl_product ON vendor_call_logs(product_id);
CREATE INDEX idx_vcl_company ON vendor_call_logs(company_id);
CREATE INDEX idx_vcl_next_action ON vendor_call_logs(next_action_at) WHERE next_action_at IS NOT NULL;

-- ADR-013 D-3: 완전 격리 (공유 안 함)
ALTER TABLE vendor_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vcl_select_own" ON vendor_call_logs
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());

CREATE POLICY "vcl_insert_own" ON vendor_call_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = current_company_id());

-- UPDATE/DELETE 금지 (immutable, ADR-010)
CREATE POLICY "vcl_no_update" ON vendor_call_logs FOR UPDATE USING (false);
CREATE POLICY "vcl_no_delete" ON vendor_call_logs FOR DELETE USING (false);
```

---

## §3.12 `product_vendor_candidates` (상품 ↔ 공급처 후보) [신규]

```sql
CREATE TABLE product_vendor_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id uuid NOT NULL REFERENCES companies(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),

  -- 후보 상태
  status text NOT NULL DEFAULT '후보',
    -- '후보' | '통화중' | '견본중' | '확정' | '탈락'

  -- 매칭 정보
  match_score numeric(5, 2),                   -- 자동 매칭 점수 (0~100)
  match_reason text,                           -- 매칭 근거 (예: '품목 정확 일치 + 지역 가산')

  -- 사용자 메모
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),

  CONSTRAINT pvc_unique UNIQUE (product_id, vendor_id),
  CONSTRAINT pvc_status_check CHECK (status IN ('후보', '통화중', '견본중', '확정', '탈락'))
);

CREATE INDEX idx_pvc_product ON product_vendor_candidates(product_id);
CREATE INDEX idx_pvc_vendor ON product_vendor_candidates(vendor_id);
CREATE INDEX idx_pvc_status ON product_vendor_candidates(status);
CREATE INDEX idx_pvc_company ON product_vendor_candidates(company_id);

ALTER TABLE product_vendor_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pvc_own" ON product_vendor_candidates
  FOR ALL TO authenticated
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
```

---

## §3.13 `vendor_access_grants` (공유 승인) [신규, ADR-013]

```sql
CREATE TABLE vendor_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  grantor_company_id uuid NOT NULL REFERENCES companies(id),  -- 풀 소유자
  grantee_company_id uuid NOT NULL REFERENCES companies(id),  -- 신청자

  status text NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected' | 'revoked'

  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES users(id),

  reason text,         -- 신청 사유
  notes text,          -- 결정 메모

  CONSTRAINT vag_unique_pair UNIQUE (grantor_company_id, grantee_company_id),
  CONSTRAINT vag_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  CONSTRAINT vag_no_self CHECK (grantor_company_id != grantee_company_id)
);

CREATE INDEX idx_vag_grantor ON vendor_access_grants(grantor_company_id);
CREATE INDEX idx_vag_grantee ON vendor_access_grants(grantee_company_id);
CREATE INDEX idx_vag_status ON vendor_access_grants(status);

-- 1번 PR: 스키마만, 정책은 4번 PR
ALTER TABLE vendor_access_grants ENABLE ROW LEVEL SECURITY;

-- 1번 PR 임시 정책 (4번 PR에서 교체)
CREATE POLICY "vag_select_own_party" ON vendor_access_grants
  FOR SELECT TO authenticated
  USING (
    grantor_company_id = current_company_id()
    OR grantee_company_id = current_company_id()
  );

CREATE POLICY "vag_grantee_insert" ON vendor_access_grants
  FOR INSERT TO authenticated
  WITH CHECK (grantee_company_id = current_company_id());

CREATE POLICY "vag_grantor_update" ON vendor_access_grants
  FOR UPDATE TO authenticated
  USING (grantor_company_id = current_company_id())
  WITH CHECK (grantor_company_id = current_company_id());
```

---

## §6 ERD 변경 요약

```
                    ┌───────────────┐
                    │   companies   │
                    └───────┬───────┘
                            │
                ┌───────────┼───────────┬─────────────┐
                ▼           ▼           ▼             ▼
         ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
         │ products  │ │ vendors  │ │suppliers │ │vendor_access │
         │           │ │          │ │ (기존)    │ │_grants       │
         └─────┬─────┘ └────┬─────┘ └──────────┘ └──────────────┘
               │            │
       ┌───────┼───────┐    │
       ▼       ▼       ▼    │
┌──────────┐┌──────┐┌──────────────────┐
│ products ││  pv  ││ product_vendor_  │
│primary_  ││  c   ││ candidates       │
│vendor_id ││      ││                  │
└──────────┘└──────┘└──────────────────┘
               │
               ▼
       ┌────────────────┐
       │vendor_call_logs│
       └────────────────┘
               │
               ▼
       ┌──────────────────┐
       │ vendor_products  │
       │ (다대다)          │
       └──────────────────┘
```

---

## §8 핵심 인덱스 추가 요약

| 인덱스 | 용도 |
|---|---|
| `idx_vendors_biz_no` | 사업자번호 dedup 매칭 |
| `idx_vendors_biz_name` (GIN tsvector) | 한글 업체명 검색 |
| `idx_vendor_products_keyword` | 자동 매칭 — 품목 키워드 검색 |
| `idx_pvc_product` | 상품 페이지에서 후보 조회 |
| `idx_vcl_next_action` | next_action 자동 작업 생성 트리거 |
| `idx_products_supply_type` (partial) | 탭 노출 분기 |
| `idx_products_primary_vendor` (partial) | 농가 → 상품 역참조 |

---

## §9 마이그레이션 전략

### 1번 PR (이번)
- `vendors`, `vendor_products`, `vendor_call_logs`, `product_vendor_candidates`, `vendor_access_grants` CREATE
- `products` 6개 컬럼 ALTER ADD (nullable, 무중단)
- RLS: 회사 격리만 (`vendors` 도 회사 격리, 공유 SELECT 는 4번 PR)
- 인덱스 모두 생성

### 4번 PR
- `vendors` 의 SELECT 정책 교체 (`vendor_access_grants` 조건 추가)
- `vendor_products` 의 SELECT 정책에도 grant 조건 추가
- 컬럼 마스킹 view 생성 (`rpersBirthdt`, `rpersGender`)

### 6번 PR
- `vendors.classification` 후처리 (사이소 데이터 채우기) — 데이터 마이그레이션
- 마이그레이션 파일에 데이터 UPDATE 포함 X (별도 스크립트로 실행)

---

## 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 0.1 | 2026-05-13 | Phase A Planner | 최초 작성 (테이블 5개 신규 + products 컬럼 6개) |
