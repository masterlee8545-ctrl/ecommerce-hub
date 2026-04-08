# DATA_MODEL — 데이터 모델 사양서

> 이 문서는 데이터베이스 스키마의 단일 근거다.
> 모든 테이블 변경은 이 문서를 먼저 갱신하고, 마이그레이션을 작성한다.
> 이 문서와 다른 스키마는 무효다.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| DB | Supabase (PostgreSQL 15+) |
| ORM | Drizzle ORM |
| 마이그레이션 | drizzle-kit |
| 관련 문서 | CPS.md, SPEC.md, ADR.md |

---

## 0. 설계 원칙

### 0.1 명명 규칙
- 테이블명: `snake_case`, 복수형 (`products`, `tasks`)
- 컬럼명: `snake_case`
- FK: `{table_singular}_id` (예: `product_id`)
- 시간 컬럼: `created_at`, `updated_at` (UTC, `timestamptz`)
- Boolean: `is_*` 또는 `has_*`

### 0.2 공통 컬럼
모든 비즈니스 테이블에 다음 컬럼 강제:
- `id` (uuid, PK)
- `company_id` (uuid, FK → companies, NOT NULL) — **멀티테넌트 RLS 키**
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, trigger로 자동 갱신)
- `created_by` (uuid, FK → users, nullable)

### 0.3 RLS (Row-Level Security)
- 모든 비즈니스 테이블에 RLS 활성화
- 정책: 사용자가 속한 회사(`user_companies`)의 데이터만 SELECT/INSERT/UPDATE/DELETE
- `audit` 테이블은 INSERT/SELECT만 허용 (UPDATE/DELETE 금지)

### 0.4 인덱스 원칙
- 모든 FK에 인덱스
- 자주 필터링되는 컬럼(`status`, `assignee_id`, `due_at`)에 인덱스
- 시계열 데이터(`created_at`, `recorded_at`)에 BRIN 인덱스 검토

---

## 1. 테이블 카탈로그 (총 21개)

### 그룹 A — 코어 (3개)
| # | 테이블 | 설명 |
|---|---|---|
| 1 | `companies` | 회사 (멀티테넌트 루트) |
| 2 | `users` | 사용자 |
| 3 | `user_companies` | 사용자-회사 다대다 (권한 등급) |

### 그룹 B — 파이프라인 (8개)
| # | 테이블 | 설명 |
|---|---|---|
| 4 | `products` | 상품 (라이프사이클 + 모든 단계 통합) |
| 5 | `product_state_history` | 상품 상태 변경 이력 (immutable) |
| 6 | `keywords` | 분석한 키워드 |
| 7 | `coupang_review_snapshots` | 쿠팡 1페이지 리뷰 분석 결과 |
| 8 | `suppliers` | 공급자 (1688) |
| 9 | `quotes` | 견적 |
| 10 | `purchase_orders` | 발주 |
| 11 | `listings` | 플랫폼 등록 |

### 그룹 C — 마케팅 (6개)
| # | 테이블 | 설명 |
|---|---|---|
| 12 | `ad_campaigns` | 광고 캠페인 |
| 13 | `ad_groups` | 광고 그룹 |
| 14 | `ad_keywords` | 광고 키워드 + 입찰가 |
| 15 | `ad_metrics` | 광고 성과 (일별) |
| 16 | `seo_targets` | SEO 목표 키워드 |
| 17 | `keyword_rankings` | 키워드 순위 추적 (시계열) |

### 그룹 D — 운영 (4개)
| # | 테이블 | 설명 |
|---|---|---|
| 18 | `tasks` | 작업 (사람이 할 일) |
| 19 | `task_history` | 작업 변경 이력 (immutable) |
| 20 | `tariff_presets` | 관세율 프리셋 |
| 21 | `notifications` | 알림 |

---

## 2. 그룹 A — 코어

### 2.1 `companies` (회사)

```typescript
// drizzle 스키마 (의사 코드)
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),                       // "바이와이즈 (주)"
  business_type: text('business_type').notNull(),    // 'industrial' | 'agricultural' | 'other'
  registration_no: text('registration_no'),          // 사업자등록번호 (선택)
  representative: text('representative'),            // 대표자명
  address: text('address'),
  phone: text('phone'),
  bw_rank_company_id: text('bw_rank_company_id'),    // BW Rank 시스템 매핑 (선택)
  default_currency: text('default_currency').notNull().default('KRW'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

**시드 데이터:**
- 바이와이즈 (주) — `industrial`
- 유어밸류 (주) — `agricultural`
- 유어옵티멀 (주) — `other`

### 2.2 `users` (사용자)

```typescript
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  password_hash: text('password_hash').notNull(),    // bcrypt cost ≥ 12
  avatar_url: text('avatar_url'),
  active_company_id: uuid('active_company_id'),      // 마지막 활성 회사
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### 2.3 `user_companies` (사용자-회사 다대다)

```typescript
export const userCompanies = pgTable('user_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  role: text('role').notNull(),                      // 'owner' | 'manager' | 'operator'
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.user_id, t.company_id),
  userIdx: index('uc_user_idx').on(t.user_id),
  companyIdx: index('uc_company_idx').on(t.company_id),
}));
```

**RLS 미적용 (이 테이블 자체가 권한의 근거)**

---

## 3. 그룹 B — 파이프라인

### 3.1 `products` (상품)

```typescript
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),                       // 'PROD-2026-0042' (회사 내 unique)
  name: text('name').notNull(),
  category: text('category'),                         // '생활용품', '농산물' 등
  status: text('status').notNull(),                   // 'research'|'sourcing'|'importing'|'listing'|'active'|'branding'

  // 가격 정보
  cogs_cny: decimal('cogs_cny', { precision: 12, scale: 2 }),
  cogs_cny_confidence: text('cogs_cny_confidence').default('unknown'), // 'confirmed'|'estimated'|'unknown' (ADR-007)
  cogs_krw: decimal('cogs_krw', { precision: 12, scale: 2 }),         // 환율+관세+배송 포함 최종원가
  selling_price_krw: decimal('selling_price_krw', { precision: 12, scale: 2 }),
  margin_rate: decimal('margin_rate', { precision: 5, scale: 4 }),    // 0.4178
  margin_rate_confidence: text('margin_rate_confidence').default('unknown'),

  // 소싱 관련
  primary_supplier_id: uuid('primary_supplier_id').references(() => suppliers.id),
  primary_keyword_id: uuid('primary_keyword_id').references(() => keywords.id),

  // 담당
  owner_user_id: uuid('owner_user_id').references(() => users.id),

  // 메타
  thumbnail_url: text('thumbnail_url'),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
}, (t) => ({
  companyCodeUniq: unique().on(t.company_id, t.code),
  statusIdx: index('products_status_idx').on(t.company_id, t.status),
  ownerIdx: index('products_owner_idx').on(t.owner_user_id),
}));
```

### 3.2 `product_state_history` (상품 상태 이력) — Immutable

```typescript
export const productStateHistory = pgTable('product_state_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  from_status: text('from_status'),                  // null = 최초 등록
  to_status: text('to_status').notNull(),
  changed_by: uuid('changed_by').references(() => users.id),
  changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason'),                             // 사용자가 입력한 사유 (선택)
}, (t) => ({
  productIdx: index('psh_product_idx').on(t.product_id),
}));
```

**제약: ADR-010** UPDATE/DELETE 금지 (RLS).

### 3.3 `keywords` (분석한 키워드)

```typescript
export const keywords = pgTable('keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  keyword: text('keyword').notNull(),
  source: text('source').notNull(),                   // 'naver'|'coupang'|'manual'

  // 검색량
  monthly_search_pc: integer('monthly_search_pc'),
  monthly_search_mobile: integer('monthly_search_mobile'),
  monthly_search_total: integer('monthly_search_total'),
  search_data_confidence: text('search_data_confidence').default('unknown'),

  // 가격
  avg_price_krw: decimal('avg_price_krw', { precision: 12, scale: 2 }),

  // 마진 (Claude 추정)
  estimated_margin_rate: decimal('estimated_margin_rate', { precision: 5, scale: 4 }),
  margin_confidence: text('margin_confidence').default('estimated'), // 항상 'estimated' (ADR-007)
  margin_reasoning: text('margin_reasoning'),         // Claude가 생성한 근거 텍스트

  // 난이도 (ADR-008)
  difficulty: text('difficulty'),                     // 'easy'|'medium'|'hard'
  difficulty_basis_snapshot_id: uuid('difficulty_basis_snapshot_id'),  // → coupang_review_snapshots

  // 추적
  is_tracked: boolean('is_tracked').notNull().default(false),
  analyzed_at: timestamp('analyzed_at', { withTimezone: true }).defaultNow().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
}, (t) => ({
  companyKeywordIdx: index('kw_company_keyword_idx').on(t.company_id, t.keyword),
}));
```

### 3.4 `coupang_review_snapshots` (쿠팡 1페이지 리뷰 분석) — 핵심

```typescript
export const coupangReviewSnapshots = pgTable('coupang_review_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  keyword_id: uuid('keyword_id').references(() => keywords.id),
  keyword_text: text('keyword_text').notNull(),       // 비정규화 (검색 편의)

  // 분포 통계
  total_products: integer('total_products').notNull(),  // 보통 36
  reviews_under_100: integer('reviews_under_100').notNull(),
  reviews_100_299: integer('reviews_100_299').notNull(),
  reviews_300_499: integer('reviews_300_499').notNull(),
  reviews_500_999: integer('reviews_500_999').notNull(),
  reviews_1000_plus: integer('reviews_1000_plus').notNull(),

  // 비율 (계산값, 캐시)
  ratio_under_300: decimal('ratio_under_300', { precision: 5, scale: 4 }).notNull(), // 0.6111
  ratio_under_500: decimal('ratio_under_500', { precision: 5, scale: 4 }).notNull(),

  // 평균/중앙값
  avg_review_count: integer('avg_review_count'),
  median_review_count: integer('median_review_count'),
  avg_price_krw: integer('avg_price_krw'),
  min_price_krw: integer('min_price_krw'),
  max_price_krw: integer('max_price_krw'),

  // 자동 판정 결과 (ADR-008)
  difficulty_verdict: text('difficulty_verdict').notNull(), // 'easy'|'medium'|'hard'
  verdict_rule: text('verdict_rule').notNull(),       // 'ratio_under_300_gte_50'

  // 원본 데이터 (재분석용)
  raw_products: jsonb('raw_products').notNull(),      // [{rank, name, price, reviews, rating, seller}]

  collected_at: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
  api_source: text('api_source').notNull().default('coupang-api.zpost.shop'),
  cache_expires_at: timestamp('cache_expires_at', { withTimezone: true }).notNull(), // +6h
}, (t) => ({
  keywordIdx: index('crs_keyword_idx').on(t.company_id, t.keyword_text),
}));
```

### 3.5 `suppliers` (공급자, 주로 1688)

```typescript
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),                       // '杭州XX贸易有限公司'
  source: text('source').notNull(),                   // '1688'|'taobao'|'domestic'
  source_url: text('source_url'),
  contact_info: text('contact_info'),                 // 위챗/이메일
  rating: integer('rating'),                          // 1-5
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### 3.6 `quotes` (견적)

```typescript
export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').references(() => products.id),
  supplier_id: uuid('supplier_id').references(() => suppliers.id),
  status: text('status').notNull().default('requested'), // 'requested'|'received'|'accepted'|'rejected'

  unit_price_cny: decimal('unit_price_cny', { precision: 12, scale: 2 }),
  moq: integer('moq'),                                // 최소 주문수량
  lead_time_days: integer('lead_time_days'),
  notes: text('notes'),
  spec_text: text('spec_text'),

  requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  received_at: timestamp('received_at', { withTimezone: true }),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id),
});
```

### 3.7 `purchase_orders` (발주)

```typescript
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  quote_id: uuid('quote_id').references(() => quotes.id),
  supplier_id: uuid('supplier_id').notNull().references(() => suppliers.id),
  status: text('status').notNull(),                   // 'pending'|'paid'|'shipped'|'customs'|'received'|'cancelled'

  qty: integer('qty').notNull(),
  unit_price_cny: decimal('unit_price_cny', { precision: 12, scale: 2 }).notNull(),
  total_cny: decimal('total_cny', { precision: 14, scale: 2 }).notNull(),

  shipping_cost_krw: decimal('shipping_cost_krw', { precision: 12, scale: 2 }),
  customs_cost_krw: decimal('customs_cost_krw', { precision: 12, scale: 2 }),
  exchange_rate: decimal('exchange_rate', { precision: 10, scale: 4 }), // 적용 환율

  paid_at: timestamp('paid_at', { withTimezone: true }),
  shipped_at: timestamp('shipped_at', { withTimezone: true }),
  eta: timestamp('eta', { withTimezone: true }),
  received_at: timestamp('received_at', { withTimezone: true }),

  tracking_no: text('tracking_no'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
});
```

### 3.8 `listings` (플랫폼 등록)

```typescript
export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  platform: text('platform').notNull(),               // 'coupang'|'naver_smartstore'|'11st'
  external_product_id: text('external_product_id'),   // 플랫폼의 상품 ID
  external_url: text('external_url'),
  status: text('status').notNull(),                   // 'draft'|'pending_review'|'active'|'paused'|'rejected'

  title: text('title'),                               // 플랫폼 등록용 제목
  category_path: text('category_path'),

  listed_at: timestamp('listed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  productPlatformUniq: unique().on(t.product_id, t.platform),
}));
```

---

## 4. 그룹 C — 마케팅

### 4.1 `ad_campaigns` (광고 캠페인)

```typescript
export const adCampaigns = pgTable('ad_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').references(() => products.id),
  platform: text('platform').notNull(),               // 'coupang'
  external_campaign_id: text('external_campaign_id'),
  name: text('name').notNull(),
  status: text('status').notNull(),                   // 'active'|'paused'|'ended'
  daily_budget_cap_krw: decimal('daily_budget_cap_krw', { precision: 12, scale: 2 }).notNull(), // ADR-009
  roas_threshold: decimal('roas_threshold', { precision: 5, scale: 2 }).default('3.5'),
  start_date: date('start_date'),
  end_date: date('end_date'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
});
```

### 4.2 `ad_groups` (광고 그룹)

```typescript
export const adGroups = pgTable('ad_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  campaign_id: uuid('campaign_id').notNull().references(() => adCampaigns.id),
  name: text('name').notNull(),
  status: text('status').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### 4.3 `ad_keywords` (광고 키워드 + 입찰가)

```typescript
export const adKeywords = pgTable('ad_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  group_id: uuid('group_id').notNull().references(() => adGroups.id),
  keyword: text('keyword').notNull(),
  match_type: text('match_type').notNull(),           // 'exact'|'phrase'|'broad'
  bid_krw: decimal('bid_krw', { precision: 10, scale: 2 }).notNull(),
  status: text('status').notNull(),                   // 'active'|'paused'
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  groupKeywordUniq: unique().on(t.group_id, t.keyword, t.match_type),
}));
```

### 4.4 `ad_metrics` (광고 성과 일별)

```typescript
export const adMetrics = pgTable('ad_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  campaign_id: uuid('campaign_id').notNull().references(() => adCampaigns.id),
  group_id: uuid('group_id').references(() => adGroups.id),
  keyword_id: uuid('keyword_id').references(() => adKeywords.id),
  date: date('date').notNull(),

  impressions: integer('impressions').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  spend_krw: decimal('spend_krw', { precision: 12, scale: 2 }).notNull().default('0'),
  conversions: integer('conversions').notNull().default(0),
  revenue_krw: decimal('revenue_krw', { precision: 14, scale: 2 }).notNull().default('0'),
  roas: decimal('roas', { precision: 6, scale: 2 }),  // 계산 컬럼 또는 트리거
  ctr: decimal('ctr', { precision: 5, scale: 4 }),
  cpc_krw: decimal('cpc_krw', { precision: 10, scale: 2 }),

  recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  source: text('source').notNull(),                   // 'coupang_api'|'manual'|'bw_rank'
}, (t) => ({
  campaignDateIdx: index('am_campaign_date_idx').on(t.campaign_id, t.date),
}));
```

### 4.5 `seo_targets` (SEO 목표 키워드)

```typescript
export const seoTargets = pgTable('seo_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  keyword: text('keyword').notNull(),
  platform: text('platform').notNull(),               // 'coupang'|'naver'
  target_rank: integer('target_rank').notNull(),      // 목표 순위 (예: 10)
  current_rank: integer('current_rank'),              // 최신 캐시
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  productKeywordUniq: unique().on(t.product_id, t.keyword, t.platform),
}));
```

### 4.6 `keyword_rankings` (순위 추적 시계열)

```typescript
export const keywordRankings = pgTable('keyword_rankings', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  seo_target_id: uuid('seo_target_id').notNull().references(() => seoTargets.id),
  rank: integer('rank'),                              // null = 미노출
  page: integer('page'),                              // 1, 2, 3...
  recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  source: text('source').notNull(),                   // 'bw_rank'|'manual'
}, (t) => ({
  targetTimeIdx: index('kr_target_time_idx').on(t.seo_target_id, t.recorded_at),
}));
```

---

## 5. 그룹 D — 운영

### 5.1 `tasks` (작업) — 핵심

```typescript
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  product_id: uuid('product_id').references(() => products.id),

  task_type: text('task_type').notNull(),             // SPEC §7의 15종 중 하나
  title: text('title').notNull(),
  description: text('description'),

  status: text('status').notNull().default('pending'), // 'pending'|'in_progress'|'review'|'done'|'cancelled'
  priority: text('priority').notNull().default('normal'), // 'urgent'|'high'|'normal'|'low'

  assignee_id: uuid('assignee_id').references(() => users.id),
  due_at: timestamp('due_at', { withTimezone: true }),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),

  // 멱등성 키 (ADR-005)
  idempotency_key: text('idempotency_key'),           // 'transition:{product_id}:{from}:{to}:{task_type}'

  // 메타
  metadata: jsonb('metadata'),                        // 작업별 추가 정보
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
  source: text('source').notNull().default('auto'),   // 'auto'|'manual'
}, (t) => ({
  assigneeStatusIdx: index('tasks_assignee_status_idx').on(t.assignee_id, t.status),
  productIdx: index('tasks_product_idx').on(t.product_id),
  dueIdx: index('tasks_due_idx').on(t.due_at),
  idempotencyUniq: unique().on(t.idempotency_key),    // 자동 생성 중복 방지
}));
```

### 5.2 `task_history` (작업 변경 이력) — Immutable

```typescript
export const taskHistory = pgTable('task_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  field: text('field').notNull(),                     // 'status'|'assignee'|'due_at'|...
  old_value: text('old_value'),
  new_value: text('new_value'),
  changed_by: uuid('changed_by').references(() => users.id),
  changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
});
```

**제약: ADR-010** UPDATE/DELETE 금지.

### 5.3 `tariff_presets` (관세율 프리셋)

```typescript
export const tariffPresets = pgTable('tariff_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),                       // '생활용품 8%'
  category: text('category'),
  tariff_rate: decimal('tariff_rate', { precision: 5, scale: 4 }).notNull(),  // 0.08
  vat_rate: decimal('vat_rate', { precision: 5, scale: 4 }).notNull().default('0.10'),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

**시드 데이터:**
- 생활용품 — 8%
- 의류 — 13%
- 가전 소품 — 8%
- 무관세 — 0%

### 5.4 `notifications` (알림)

```typescript
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  user_id: uuid('user_id').notNull().references(() => users.id),

  type: text('type').notNull(),                       // 'task_assigned'|'roas_alert'|'rank_drop'|...
  severity: text('severity').notNull().default('info'), // 'critical'|'warning'|'info'

  title: text('title').notNull(),
  body: text('body'),
  link_url: text('link_url'),                         // 클릭 시 이동

  is_read: boolean('is_read').notNull().default(false),
  read_at: timestamp('read_at', { withTimezone: true }),

  // 관련 엔티티
  related_task_id: uuid('related_task_id').references(() => tasks.id),
  related_product_id: uuid('related_product_id').references(() => products.id),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userUnreadIdx: index('notif_user_unread_idx').on(t.user_id, t.is_read),
}));
```

---

## 6. ERD 요약

```
companies ───┬── user_companies ──── users
             │
             ├── products ──┬── product_state_history
             │              ├── quotes
             │              ├── purchase_orders ── suppliers
             │              ├── listings
             │              ├── ad_campaigns ── ad_groups ── ad_keywords ── ad_metrics
             │              ├── seo_targets ── keyword_rankings
             │              └── tasks ── task_history
             │
             ├── keywords ── coupang_review_snapshots
             ├── tariff_presets
             └── notifications
```

---

## 7. RLS 정책 템플릿

```sql
-- 모든 비즈니스 테이블에 동일 패턴 적용
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select_own_company ON products
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM user_companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY products_insert_own_company ON products
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM user_companies
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- UPDATE, DELETE 정책 동일 패턴
```

**Audit 테이블 (immutable):**
```sql
-- product_state_history, task_history는 INSERT/SELECT만 허용
CREATE POLICY psh_no_update ON product_state_history
  FOR UPDATE USING (false);
CREATE POLICY psh_no_delete ON product_state_history
  FOR DELETE USING (false);
```

---

## 8. 핵심 인덱스 요약

| 테이블 | 인덱스 | 용도 |
|---|---|---|
| `products` | `(company_id, status)` | 상태별 목록 조회 |
| `tasks` | `(assignee_id, status)` | 내 작업 조회 |
| `tasks` | `(due_at)` | 마감 임박 조회 |
| `tasks` | `idempotency_key` UNIQUE | 자동 생성 중복 방지 |
| `ad_metrics` | `(campaign_id, date)` | 일별 성과 조회 |
| `keyword_rankings` | `(seo_target_id, recorded_at)` | 시계열 차트 |
| `coupang_review_snapshots` | `(company_id, keyword_text)` | 캐시 조회 |

---

## 9. 마이그레이션 전략

1. 초기 마이그레이션: 21개 테이블 일괄 생성
2. RLS 정책: 별도 SQL 파일 (`drizzle/migrations/rls.sql`)
3. 시드 데이터: `drizzle/seeds/` (companies 3개, tariff_presets 4종)
4. 모든 변경은 새 마이그레이션 파일 (기존 수정 금지)

---

## 10. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (21 테이블 / RLS 템플릿 / ERD) |
