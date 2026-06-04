# SPEC.md 변경분 — 농가 공급처 찾기 기능

**Phase**: A (Planner)
**날짜**: 2026-05-13
**관련**: ADR-012, ADR-013, docs/SPEC.md

> 이 문서는 `docs/SPEC.md` 에 적용할 패치 명세다.
> Phase B 1번 PR 시작 시 `docs/SPEC.md` 본 문서에 머지된다.

---

## 변경 요약

| 항목 | 변경 | 사유 |
|---|---|---|
| §4 화면 사양 | **5개 페이지 신규** | ADR-012 D-1, D-2 |
| §5 핵심 사용자 시나리오 | **S-101 시즌→농가 통화→확정** 신규 | ADR-012 D-5 |
| §6 자동화 트리거 매트릭스 | **3개 신규 트리거** | 통화 후속 작업 / 시즌 메타 연동 |
| §7 작업 카탈로그 | **5개 작업 종류 신규** | 농가 컨택 워크플로 |
| §1.3 외부 통합 | 변경 없음 (사이소·jpsmall 은 임포트 통로로만 사용) | - |
| 전체 페이지 수 | 38 → **43** | - |
| 전체 작업 종류 | 15 → **20** | - |

---

## §4 화면 사양 (신규 페이지 5개)

기존 §4.5 "③ 상품 관리 (4개)" 다음에 신규 섹션 추가:

### 4.5b ② 소싱 — 농가 공급처 (5개) [신규]

- `/products/[id]/find-vendor` ⭐ — **상품 안 "공급처 찾기" 탭 (진입점)**
  - 시즌 메타(피크월/시즌성) 표시
  - 자동 매칭된 농가 카드 그리드
  - 카드별 액션: [📞 통화] [⭐ 후보] [❌ 탈락]
  - 모바일이면 `tel:` 자동 발신
  - "이 상품 공급처로 확정" 버튼 → `products.primary_vendor_id` 갱신
- `/vendors/[id]` — 농가 상세 페이지
  - 사업자 정보, 주소, 품목, 활성도 (also_listed_on)
  - 통화 타임라인 (회사별 격리)
  - 큼직한 [📞 발신] 버튼 + 통화 결과 기록 모달
- `/vendors/import` — CSV 임포트 통로
  - 파일 업로드 (UTF-8 BOM)
  - 헤더 자동 감지 (한글 ↔ 영문 매핑)
  - 매칭 미리보기 (신규 N건 / 업데이트 M건)
  - "확정" 버튼 트랜잭션 INSERT/UPDATE
- `/vendors` — 농가 검색/필터 (보조)
  - 업체명 / 사업자번호 / 지역 / 품목 검색
  - 페이지당 50개
  - `also_listed_on` 배지로 활성도 표시
- `/vendors/access` — 공유 풀 신청/승인 관리 [4번 PR]
  - 받은 요청 / 보낸 요청 / 활성 승인 중

### §4 페이지 수 갱신
**기존**: 총 38개
**변경 후**: 총 43개

### §3.2 상태 전이 자동 작업 매트릭스 추가

| 전이 | 자동 생성 작업 (`task_type`) | 담당자 룰 |
|---|---|---|
| `research → sourcing` (기존) | `quote_request_1688` | 소싱 담당 |
| `research → sourcing` (신규) **`supply_type='domestic_vendor'` 시** | `find_vendor_open_tab` | 소싱 담당 |
| `sourcing → importing` (신규) **공급처가 vendor 인 경우** | `vendor_sample_request`, `vendor_contract_sign` | 소싱 담당 |

---

## §5 핵심 사용자 시나리오 (신규)

### S-101 — 시즌 펄스에서 발견한 키워드로 농가 컨택 → 거래 확정

1. 이재홍이 `/research/season-pulse`에서 5월 후보 그룹 확인
2. "참외" 5점 카드의 [🛒 담기] 클릭
3. 시스템이 `products` 테이블에 새 행 생성:
   - `status='research'`
   - `name='참외'`
   - `supply_type='domestic_vendor'` (시즌 펄스 자동 추론)
   - `season_peak_month=7`, `season_prep_month=5`, `seasonality_ratio=12.5`, `season_score=5`
4. 이재홍이 상품 상세 페이지 진입
5. **"공급처 찾기" 탭** 클릭 (supply_type='domestic_vendor' 이므로 노출)
6. 자동 매칭된 농가 카드 12개 표시 (사업자번호 기반 dedup, 시즌 적합도 순)
7. 첫 번째 카드 (예: "안동참외농원") 의 [📞 통화] 버튼 클릭
8. 모바일이면 `tel:` 자동 발신, 통화 후 결과 기록 모달 띄움
9. "연결됨 / 견본 보내주신다" 선택 + 메모 입력 → `vendor_call_logs` 저장
10. `product_vendor_candidates.status='견본중'` 로 갱신
11. 견본 받은 후 [✅ 이 상품 공급처로 확정] 클릭
12. `products.primary_vendor_id` = 그 농가 ID, `status='sourcing'→'importing'` 전이
13. 자동 작업 생성: `vendor_contract_sign`, `customs_track`(농산물의 경우 위탁 발송 추적)

**검증:**
- 자동 매칭 응답 < 2초
- 통화 기록 모달 30초 안에 작성 가능
- 신뢰도 마킹 누락 0 (P-3)

---

## §6 자동화 트리거 매트릭스 (신규 3개)

기존 표 끝에 추가:

| 트리거 | 조건 | 동작 |
|---|---|---|
| **시즌 펄스 담기** (신규) | `/api/products/quick-add-from-season-pulse` 호출 | `products` INSERT + 시즌 메타 컬럼 자동 채움 + `supply_type` 자동 추론 |
| **통화 후 next_action** (신규) | `vendor_call_logs.next_action != NULL` AND `next_action_at > now()` | `tasks` 자동 생성 (`task_type='vendor_followup'`, 담당=통화한 사용자, due=next_action_at) |
| **공유 승인 요청** (신규) | `vendor_access_grants.status='pending'` INSERT | grantor 회사 owner/manager에게 알림 |

---

## §7 사람 작업 카탈로그 (신규 5종)

기존 15종 끝에 추가:

| 코드 | 카테고리 | 제목 | 기본 담당 | 기본 D-day | 자동 생성 트리거 |
|---|---|---|---|---|---|
| `find_vendor_open_tab` | 소싱 | 공급처 찾기 탭 확인 | 소싱 담당 | D-2 | 시즌 펄스 담기 시 (supply_type=domestic_vendor) |
| `vendor_call` | 소싱 | 농가 통화 | 소싱 담당 | D-1 | "후보 등록" 시 |
| `vendor_followup` | 소싱 | 농가 후속 연락 | 소싱 담당 | 통화 시 입력 | `vendor_call_logs.next_action` |
| `vendor_sample_request` | 소싱 | 농가 견본 요청 | 소싱 담당 | D-3 | 후보→견본중 전이 |
| `vendor_contract_sign` | 소싱 | 농가 위탁 계약 체결 | 매니저 | D-7 | 견본중→확정 전이 |

### §7 총합 갱신
**기존**: 15종
**변경 후**: 20종

---

## §8.1 성능 추가 기준 (NFR)

기존 성능 항목에 추가:
- **농가 자동 매칭** (`/products/[id]/find-vendor` 로드) < 2초 (50개 키워드 풀 기준)
- **CSV 임포트 미리보기** (`/vendors/import`) — 2,000건 < 5초
- **CSV 임포트 확정** — 2,000건 트랜잭션 < 15초
- **`/vendors` 검색** — 50개 결과 < 800ms

---

## 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 0.1 | 2026-05-13 | Phase A Planner | 최초 작성 (페이지 5개 + 시나리오 1 + 트리거 3 + 작업 5) |
