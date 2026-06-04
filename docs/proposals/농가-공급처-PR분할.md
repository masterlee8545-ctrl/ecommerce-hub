# PR 분할 목록 — 농가 공급처 찾기 기능

**Phase**: A (Planner)
**날짜**: 2026-05-13
**관련**: ADR-012, ADR-013, SPEC 변경분, DATA_MODEL 변경분

> 총 **6개 PR** 로 분할. 각 PR마다 자기검증 5+1 + Evaluator 호출.
> 1번 PR 끝나야 2번 시작, 순차 진행.

---

## 전체 의존성

```
       1번 (인프라)
        │
        ├─────────┬─────────┬───────────┐
        ▼         ▼         ▼           ▼
       2번      3번        5번         6번
    (매칭)   (통화기록)  (시즌연계)  (분류후처리)
        │
        ▼
       4번
    (공유승인)
```

- **1번** 끝나야 모든 PR 시작 가능 (테이블 + 임포트 + 검색이 인프라)
- **2번 ↔ 3번 ↔ 5번 ↔ 6번** 은 서로 독립, 동시 진행 가능
- **4번** 은 2번 끝난 후 (공유받은 농가도 매칭 대상에 들어가야 의미 있음)

---

## 1번 PR — 마스터 DB + 임포트 통로 + 검색

**범위**: 농가 마스터 인프라 구축. 데이터 들어가야 그 다음 PR이 의미를 가짐.

### 산출물
- **마이그레이션 5개 + products 컬럼 추가**
  - `0010_vendors.sql` (테이블 + 인덱스 + RLS 회사 격리)
  - `0011_vendor_products.sql`
  - `0012_vendor_call_logs.sql` (immutable, INSERT만)
  - `0013_product_vendor_candidates.sql`
  - `0014_vendor_access_grants.sql` (스키마만, 본격 정책은 4번 PR)
  - `0015_products_supply_columns.sql` (6개 컬럼 ALTER ADD)
- **Drizzle 스키마**
  - `src/db/schema/vendors.ts`
  - `src/db/schema/vendor_products.ts`
  - `src/db/schema/vendor_call_logs.ts`
  - `src/db/schema/product_vendor_candidates.ts`
  - `src/db/schema/vendor_access_grants.ts`
  - `src/db/schema/products.ts` 컬럼 추가
  - `src/db/schema/index.ts` re-export 갱신
- **임포트 통로 페이지**
  - `src/app/(app)/vendors/import/page.tsx` (서버)
  - `src/app/(app)/vendors/import/import-form.tsx` (클라이언트)
  - `src/lib/vendors/import.ts` — 헤더 자동 감지 + 매핑 + dedup
  - `src/app/api/vendors/import/preview/route.ts` — 미리보기 API
  - `src/app/api/vendors/import/confirm/route.ts` — 확정 트랜잭션
- **검색 페이지 (보조)**
  - `src/app/(app)/vendors/page.tsx`
  - `src/app/(app)/vendors/[id]/page.tsx` (간단 상세, 통화 모달은 3번 PR)
  - `src/lib/vendors/search.ts`

### 검증
1. 마이그레이션 적용 후 5개 테이블 + products 컬럼 존재 (drizzle-kit studio 또는 `\dt` 확인)
2. `/vendors/import` 에서 `C:\개발\크롤링\cyso_all_sellers.csv` 업로드 → 미리보기 → 확정 → DB에 약 1,700건 들어감
3. `C:\개발\크롤링\all_sellers.csv` 추가 업로드 → dedup 후 약 1,833건 (사업자번호 정규화 매칭)
4. `/vendors` 검색:
   - "남탑산방" → 사이소-안동장터 출처 1건
   - "토마토마" → all_sellers.csv 데이터 1건
5. 회사 격리 RLS 확인: 다른 회사로 전환 후 `/vendors` 비어있음
6. 자기검증 5+1 + Evaluator 호출

### 비범위 (이 PR에서 안 함)
- `/products/[id]/find-vendor` 탭 ← 2번 PR
- 자동 매칭 알고리즘 ← 2번 PR
- 통화 모달 ← 3번 PR
- `vendor_access_grants` 의 공유 SELECT RLS ← 4번 PR
- `/vendors/access` UI ← 4번 PR
- 시즌 펄스 → products 시즌 메타 자동 채움 ← 5번 PR
- 사이소 `classification` 후처리 ← 6번 PR

### 예상 소요
**6~10시간** (마이그레이션 + 임포트 통로가 가장 큼)

### 보고
> "전북·경북 농가/업체 약 1,833명이 마스터 DB에 들어왔어요. 사업자번호 정규화 후 같은 농가가 여러 몰에 입점한 경우 124명을 자동으로 묶었어요. 검색 화면에서 '남탑산방', '토마토마' 같은 키워드 찾으면 바로 나옵니다."

---

## 2번 PR — `/products/[id]/find-vendor` 탭 + 자동 매칭

**범위**: 상품 페이지의 진입점. 1번 PR이 끝나야 의미 있음.

### 산출물
- **자동 매칭 알고리즘**
  - `src/lib/vendors/match.ts`
    - 입력: 상품 name + supply_type + (있으면) season_peak_month, primary_keyword
    - 단계: 품목 키워드 추출 → `vendor_products` 매칭 → 가공품 환원 사전 → 점수 산정
    - 점수 가중치: 정확 일치(50) + 부분 일치(30) + 시즌 적합(20) + `also_listed_on` 활성도(15) + 지역(10) + 인증(5)
    - 출력: `Array<{ vendor: Vendor, score: number, reasons: string[] }>` 정렬됨
  - 키워드 사전: `C:\개발\크롤링\aggregate_and_classify.py` 의 `PRODUCT_KEYWORDS` 를 TS 로 포팅
  - 가공품 환원: `딸기잼 → 딸기`, `감귤청 → 감귤`, `참외에이드 → 참외` (~30개)
- **API**
  - `GET /api/products/[id]/vendor-candidates` — 자동 매칭 결과
  - `POST /api/products/[id]/vendor-candidates` — 후보 추가/상태 변경
- **UI**
  - `src/app/(app)/products/[id]/find-vendor/page.tsx`
  - `src/app/(app)/products/[id]/find-vendor/vendor-card.tsx`
  - 상품 상세 페이지 (`/products/[id]/page.tsx`) 에 "공급처 찾기" 탭 추가
    - `supply_type` 따라 조건부 노출 (ADR-012 D-2)

### 검증
- 시즌 펄스에서 "참외" 담음 → 상품 상세 → "공급처 찾기" 탭 노출됨 (supply_type=domestic_vendor)
- 자동 매칭 결과 1~50개 카드 표시, 매칭 점수 + 이유 표시
- "캠핑의자" 같은 공산품 담음 → "공급처 찾기" 탭 숨김 (supply_type=overseas_supplier)
- 매칭 응답 < 2초

### 예상 소요
**4~6시간**

### 보고
> "상품 페이지에 '공급처 찾기' 탭이 생겼어요. 농가 자동 매칭이 1~2초 안에 끝나요. 예: '참외' 상품 만들면 → 안동참외농원, 성주참외농가 등 12곳이 점수순으로 보여요."

---

## 3번 PR — 통화 모달 + `vendor_call_logs` 활성화

**범위**: 농가 카드의 [📞 통화] 버튼 → 통화 결과 30초 기록.

### 산출물
- **통화 모달**
  - `src/app/(app)/vendors/[id]/call-modal.tsx` (클라이언트)
  - 트리거: 농가 카드의 [📞 통화] / 상세 페이지의 [📞 발신]
  - 모바일이면 `tel:` 자동 발신
  - 통화 결과 폼: channel + result 드롭다운 + notes textarea + next_action + next_action_at
- **서버 액션**
  - `src/lib/vendors/call.ts` — `recordCallAction(formData)`
  - INSERT 후 `product_vendor_candidates.status` 조건부 갱신
  - `next_action_at` 있으면 `tasks` 테이블에 후속 작업 생성 (`vendor_followup`)
- **타임라인**
  - `src/app/(app)/vendors/[id]/timeline.tsx` — 회사별 격리된 통화 기록 표시
- **자동 작업**
  - SPEC §6 추가 트리거 구현: `vendor_call_logs.next_action != NULL` → `tasks` INSERT

### 검증
- "안동참외농원" 농가 카드 → [📞 통화] → 모달 뜸
- "연결됨 + 견본 보내주신다 + next_action=재통화, +3일" 저장 → `vendor_call_logs` 1 row 생성
- `tasks` 테이블에 `vendor_followup` 작업 자동 생성 (D+3 마감)
- 다른 회사로 전환하면 그 통화 기록 안 보임 (P-5 / ADR-013 D-3)

### 예상 소요
**3~5시간**

### 보고
> "통화 버튼 누르면 자동 전화 + 통화 끝나면 30초짜리 기록 폼이 떠요. '재통화 3일 후' 같은 후속 일정 입력하면 작업 보드에 자동 추가됩니다."

---

## 4번 PR — `vendor_access_grants` RLS + `/vendors/access` UI ⭐

**범위**: 농가 풀 공유 승인제. ADR-013 본격 구현. 2번 PR이 끝나야 매칭이 grantor 풀까지 닿음.

### 산출물
- **마이그레이션**
  - `0016_vendor_access_grants_rls.sql` — `vendors`, `vendor_products` 의 SELECT 정책 교체
  - 컬럼 마스킹 view: `vendors_for_grantee` (rpersBirthdt, rpersGender NULL 마스킹)
- **승인 관리 UI**
  - `src/app/(app)/vendors/access/page.tsx`
    - 받은 요청 / 보낸 요청 / 활성 승인 중 3개 섹션
  - `src/app/(app)/vendors/access/request-modal.tsx` (grantee 측)
  - 서버 액션:
    - `requestAccessAction(grantorCompanyId, reason)`
    - `approveAccessAction(grantId, notes)`
    - `rejectAccessAction(grantId, notes)`
    - `revokeAccessAction(grantId, notes)`
- **알림 통합**
  - `vendor_access_grants` INSERT 시 grantor owner/manager 에게 알림
  - 결정(approved/rejected) 시 grantee 에게 알림
- **UI 배지**
  - `/vendors` 검색 결과 카드에 "🔓 공유받음 — by 회사명" 배지
- **매칭 알고리즘 갱신** (2번 PR이 만든 `match.ts` 패치)
  - `vendors` 조회 범위 = 자기 회사 + 승인된 grantor 회사
  - grantee 측에서 매칭된 농가에 "공유받은 풀" 라벨 추가

### 검증
- 강의생 A 가입 → `/vendors/access` → "BUYWISE.CO 풀 신청"
- 이재홍 owner 알림 받음 → `/vendors/access` 에서 [✅ 승인]
- 강의생 A 가 `/vendors` 들어가면 BUYWISE 풀 농가도 검색됨 (배지 표시)
- 강의생 A 가 `vendors.rpersBirthdt` 조회 시 NULL (마스킹 확인)
- 강의생 A 가 BUYWISE 농가의 통화 기록은 못 봄 (ADR-013 D-3)

### 예상 소요
**5~7시간**

### 보고
> "농가 풀 공유 시스템이 활성화됐어요. 강의생이 '풀 공유받기' 신청하면 형이 승인/거절할 수 있어요. 승인된 강의생은 형 농가 목록을 검색하지만, 형의 통화 기록은 안 보입니다. 농가 생년월일 같은 민감 정보는 자동으로 가려져요."

---

## 5번 PR — 시즌 펄스 연계 (담을 때 시즌 메타 자동 저장)

**범위**: 시즌 펄스 카드의 [🛒 담기] 동작에 시즌 메타 자동 채움. 기능 자체는 작지만 사용성에 핵심.

### 산출물
- **서버 액션 수정**
  - `src/lib/products/actions.ts` 의 `quickAddToBasketAction` 에 시즌 메타 파라미터 추가
  - 또는 신규 `quickAddFromSeasonPulseAction(keyword, peak, prep, ratio, score, autoSupplyType)`
- **`supply_type` 자동 추론**
  - `src/lib/products/infer-supply-type.ts`
    - 키워드 사전 매칭 (농산물 키워드 시 `domestic_vendor`)
    - 자신 없으면 NULL (탭 둘 다 노출)
- **시즌 펄스 카드 수정**
  - `src/app/(app)/research/season-pulse/season-pulse-client.tsx` 의 `handleAddToBasket` 변경
  - 시즌 메타 + 추론된 supply_type 전송
- **상품 상세 페이지 표시**
  - 시즌 메타 있는 상품은 "🌊 5월 추천 | 피크 7월 | 시즌성 12.5x" 라벨 표시
  - "공급처 찾기" 탭에서 시즌 메타를 매칭 점수 가중치로 활용

### 검증
- 시즌 펄스에서 "참외" 담음 → `/products` 목록에서 그 상품에 시즌 라벨 보임
- DB 확인: `products.season_peak_month=7`, `season_prep_month=5`, `seasonality_ratio≈12.5`, `season_score=5`, `supply_type='domestic_vendor'`
- "캠핑의자" 담음 → `supply_type='overseas_supplier'`
- "다이어트보조제" 같은 모호한 거 담음 → `supply_type=NULL`

### 예상 소요
**2~3시간**

### 보고
> "시즌 펄스에서 '담기' 누르면 그 키워드의 시즌 정보(피크월, 시즌성 등)와 농가/도매상 어느 쪽인지 자동으로 채워서 상품을 만들어요. 그 상품을 열면 시즌 정보가 보이고, '공급처 찾기' 탭이 자동으로 농가용/도매상용 둘 중 맞는 거 보여줍니다."

---

## 6번 PR — 사이소 `classification` 후처리

**범위**: 사이소에서 가져온 1,728건의 `classification` 컬럼이 비어있음. `bizType + bizSector` 텍스트 + 기존 `aggregate_and_classify.py` 정규식 패턴으로 채움.

### 산출물
- **TS 포팅 모듈**
  - `src/lib/vendors/classify.ts` — `aggregate_and_classify.py` 의 정규식 로직 포팅
  - 입력: `bizName, bizType, bizSector, productKeywordsAll`
  - 출력: `{ classification, classification_basis }`
  - 분류 값: `1차_농가 | 1차_법인 | 1차_상품기반 | 1차_혼합 | 농협 | 농협가공 | 가공유통 | 가공_상품기반 | 불명`
- **마이그레이션 스크립트** (데이터 마이그레이션)
  - `scripts/classify-vendors.ts` — `classification IS NULL` 인 row 일괄 분류
  - 변경 사항 미리보기 → 사용자 승인 → 일괄 UPDATE
- **검색 필터 추가**
  - `/vendors` 페이지에 `classification` 필터 (1차_농가 / 가공유통 / ...)

### 검증
- 스크립트 실행 → 사이소 1,728건 중 `classification` 채워진 비율 > 80%
- "1차_농가" 필터로 검색 → 농산물 농가만 나옴
- "가공유통" 필터로 검색 → 가공품 유통업체만 나옴

### 예상 소요
**3~4시간**

### 보고
> "사이소에서 가져온 농가 1,728개의 '분류'(1차_농가/가공유통 등) 컬럼을 채웠어요. 이제 검색에서 '1차 농가만' 같은 필터를 쓸 수 있고, 자동 매칭에서도 분류를 점수 가중치로 활용합니다."

---

## 비범위 (이 의뢰서 전체에서 안 함)

다음은 본 의뢰서 범위 밖. 별도 의뢰서 필요:
- 상품 정보 (productCount, productKeywordsAll, productsTop10) 추가 크롤링 — 사이소 셀러별 상품 API 호출
- 사이소 토큰 자동 갱신 — 1시간 만료 처리
- 카페24 다중입점 / 위사 / jnmall(SPA) 크롤러 — 다음 데이터 보강 시
- 농가 통계 대시보드 — 카테고리별 농가 수, 활발도 분포 등
- 농가-키워드 양방향 매칭 (농가 페이지에서 "이 농가가 다룰만한 시즌 키워드") — Phase B 끝나면 결정

---

## 위험 / 가정

### 위험
1. **사이소 1,728건 dedup 결과 예상보다 적을 수 있음** — 사업자번호 정규화 후 ~1,833건 가정인데 실측 시 ±10% 변동 가능. **완화**: 1번 PR 검증에서 실측 후 보고 수치 조정
2. **자동 매칭 점수 튜닝** — 가중치(50/30/20/15/10/5)는 첫 안. 실제 운영에서 사용자 피드백으로 조정 필요. **완화**: 2번 PR에서 가중치를 환경변수 또는 DB 컬럼으로 노출
3. **사이소 토큰 만료** — 1시간이라 다음 크롤링 때 새 토큰 필요. **완화**: 본 의뢰서 PR 범위 밖. 별도 처리
4. **사이소 classification 정규식 정확도** — 기존 `aggregate_and_classify.py` 의 한국 사업자 분류 패턴이 cyso 데이터에도 그대로 적용 가능한지 불확실. **완화**: 6번 PR에서 샘플 100개 수동 검증

### 가정
- 1,728건의 cyso 데이터와 239건의 all_sellers.csv 데이터는 사업자번호 0건 겹침 (전북 vs 경북 자연 분리, 실측 확인됨)
- 강의생 확장은 Phase 3 이후. 1번 PR 시점에는 강의생 사용자 0명
- BUYWISE.CO 외 가입자 0명 (Phase 3까지)
- `infer-supply-type` 의 키워드 사전은 ~50개 농산물 + ~30개 공산품 카테고리로 시작

---

## 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 0.1 | 2026-05-13 | Phase A Planner | 최초 작성 (6개 PR 분할) |
