# 형제 프로젝트 동기화 가이드 (Cross-Project Sync)

> 이 문서는 ecommerce-hub와 형제 프로젝트들 사이의 의존 관계, 동기화 절차, 변경 영향도를 정의한다.
> 형제 프로젝트의 변경이 ecommerce-hub에 영향을 줄 수 있는 모든 경로를 추적한다.

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.0 |
| 작성일 | 2026-04-07 |
| 관련 ADR | ADR-008 (BUYWISE 알고리즘), ADR-011 (InfoHub 계약) |
| 관련 헌법 | CLAUDE.md §1 P-8, §8 형제 프로젝트 계약 |

---

## 1. 형제 프로젝트 맵

```
                        ┌─────────────────────────────────┐
                        │   ecommerce-hub (현재 프로젝트)  │
                        │   BUYWISE 통합관리 시스템        │
                        └────┬────────┬──────────┬────────┘
                             │        │          │
              ┌──────────────┘        │          └──────────────┐
              │ MCP 소비                │ 알고리즘 포팅          │ 독립
              │                        │                        │
              ▼                        ▼                        ▼
  ┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐
  │  InfoHub            │  │  naver-keyword정환   │  │  buywise-marketing  │
  │  (정보취합-2)       │  │  (BUYWISE Python)    │  │  (포트 3001)        │
  │                     │  │                      │  │                     │
  │  28개 소스 수집/분석│  │  쿠팡 리뷰 알고리즘  │  │  광고 자동화        │
  │  MCP 인프라         │  │  키워드 점수 산정    │  │                     │
  └─────────────────────┘  └──────────────────────┘  └─────────────────────┘
              │
              │ 형제 프로젝트 관계
              │ (양방향 계약)
              │
              ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 다른 InfoHub 소비자들 (4개 형제 프로젝트)               │
  │ - aiboss-autoposter                                      │
  │ - buywise-sns-analyzer                                   │
  │ - 카페 키우기                                            │
  │ - (이커머스-hub 포함)                                    │
  └─────────────────────────────────────────────────────────┘
```

---

## 2. 의존 관계 매트릭스

| ecommerce-hub 영역 | 의존 형제 프로젝트 | 의존 자산 | 동기화 빈도 | 깨질 위험 |
|---|---|---|---|---|
| Research 단계 | InfoHub | MCP 응답 스키마 (`/api/items`) | 호출 시마다 | **HIGH** (P-8) |
| Sourcing 단계 | InfoHub | MCP 응답 스키마 (`/api/items`) | 호출 시마다 | **HIGH** (P-8) |
| 쿠팡 난이도 알고리즘 | naver-keyword정환 | Python 코드 (참조) | ADR-008 변경 시 | LOW (포팅 완료) |
| BW Rank 호출 | (자체 인프라) | `api.bw-rank.kr` | 변경 알림 시 | MEDIUM (ADR-006) |
| Coupang Review | (자체 인프라) | `coupang-api.zpost.shop` | 변경 알림 시 | MEDIUM (ADR-008) |
| 광고 자동화 | buywise-marketing-tool | (없음 — 독립) | N/A | LOW |
| SNS 분석 | buywise-sns-analyzer | (없음 — 독립) | N/A | LOW |

---

## 3. InfoHub 동기화 프로토콜 (가장 중요)

### 3.1 우리 측 의무 (ecommerce-hub → InfoHub)
- ✅ InfoHub MCP 응답을 zod로 검증 (P-8)
- ✅ 의존 필드 목록을 `docs/INFOHUB_INTEGRATION.md` §4.1에 명시
- ✅ 사용 시점/빈도를 InfoHub 팀에 공유
- ❌ InfoHub 측 코드 직접 수정 금지
- ❌ InfoHub MCP 도구를 wrapper 없이 직접 호출 (Phase 2 모드 B 도입 시)

### 3.2 InfoHub 측 의무 (InfoHub → ecommerce-hub)
출처: `C:/개발/정보취합-2/CLAUDE.md` §P-5
- ✅ MCP 응답 스키마 변경 시 모든 소비자에게 사전 통지
- ✅ Breaking change는 최소 2주 deprecation 기간
- ✅ 의존 소비자(우리 포함)가 사용 중인 필드 확인 후 변경
- ❌ 무단 필드 삭제/이름 변경 금지

### 3.3 동기화 체크포인트
| 시점 | 액션 | 담당 |
|---|---|---|
| ecommerce-hub Phase 1 시작 | 의존 필드 목록 InfoHub 팀에 공유 | ecommerce-hub |
| 매주 월요일 | InfoHub `mcp-server/index.ts` Read해서 스키마 변경 확인 | ecommerce-hub |
| InfoHub 메이저 업데이트 | 응답 스키마 변경사항 검토 + 우리 측 wrapper 갱신 | ecommerce-hub |
| 우리 측 신규 InfoHub 호출 추가 | 의존 필드 목록 갱신 + InfoHub 팀 알림 | ecommerce-hub |
| InfoHub MCP 서버 배포 실패 | bugs.md 기록 + 우리 작업 일시 중단 | ecommerce-hub |

### 3.4 정기 점검 절차 (매주 월요일)
```bash
# 1. InfoHub MCP 서버 코드 변경 확인
git -C "C:/개발/정보취합-2" log --since="1 week ago" --oneline -- mcp-server/

# 2. 변경이 있으면 mcp-server/index.ts Read
# 3. ecommerce-hub의 docs/INFOHUB_INTEGRATION.md §4.1과 비교
# 4. 차이가 있으면:
#    - bugs.md에 기록
#    - 우리 측 zod 스키마 갱신 PR
#    - InfoHub 팀에 통지
```

---

## 4. naver-keyword정환 동기화 (참조 전용)

### 4.1 관계
- naver-keyword정환은 BUYWISE 시스템의 **Python 전신**
- ecommerce-hub의 **쿠팡 진입 난이도 알고리즘** (ADR-008)이 여기서 포팅됨
- 코드 의존성은 없음 (참조만)

### 4.2 알고리즘 동기화
ADR-008의 규칙:
| 조건 | 결과 |
|---|---|
| 리뷰 <300 비율 ≥ 50% | **쉬움 (easy)** |
| 리뷰 <500 비율 ≥ 70% | **중간 (medium)** |
| 그 외 | **어려움 (hard)** |

이 규칙이 naver-keyword정환에서 변경되면 **사용자 명시적 결정 후** ADR-008 갱신.
자동 동기화 금지 — Python 측 변경은 검증 안 된 실험일 수 있음.

### 4.3 동기화 절차
1. naver-keyword정환에서 알고리즘 변경 발생
2. 사용자가 ecommerce-hub에 적용 의사 표시
3. 새 ADR 작성 (ADR-008 supersede)
4. `src/lib/research/difficulty.ts` 갱신
5. 단위 테스트 갱신 (경계값 검증)

---

## 5. 자체 인프라 동기화 (BW Rank, Coupang Review)

### 5.1 BW Rank API (`api.bw-rank.kr`)
- 우리 자체 인프라이지만 ecommerce-hub와 별도 배포
- 변경 책임: BW Rank 팀
- 동기화 의무:
  - BW Rank API 응답 스키마 변경 시 ecommerce-hub `app/api/bwrank/*/route.ts` 갱신
  - 사용 엔드포인트 5개 (ADR-006):
    - `/product-score`
    - `/coupang-search`
    - `/stock-sales`
    - `/brand-sales`
    - `/traffic-check`

### 5.2 Coupang Review API (`coupang-api.zpost.shop`)
- 우리 자체 프록시 (1페이지 36개 리뷰 수집용)
- 변경 책임: Coupang Review 팀
- 응답 스키마 (ADR-008 의존):
  - `products: { reviewCount: number, ... }[]`
  - 36개 고정 (1페이지 = 36개)
- 변경 시 영향:
  - `src/lib/research/difficulty.ts` 갱신
  - `coupang_review_snapshots` 테이블 마이그레이션
  - UI: 36개 카드 컴포넌트 갱신

---

## 6. 변경 영향도 분석 (Impact Analysis)

### 6.1 InfoHub 변경 시
| InfoHub 변경 종류 | ecommerce-hub 영향 | 대응 |
|---|---|---|
| 새 소스 추가 (ALL_SOURCES 확장) | 없음 (옵션) | `agents/infohub.md` §3 매트릭스 갱신 (선택) |
| 기존 소스 제거 | **HIGH** — 우리가 사용 중이면 깨짐 | 즉시 대체 소스 결정 |
| MCP 도구 추가 | 없음 | 활용 검토 (선택) |
| MCP 도구 제거 | **CRITICAL** | 즉시 작업 중단, 대체 방법 결정 |
| 응답 필드 추가 | 없음 (zod schema는 unknown 필드 무시) | 활용 검토 (선택) |
| 응답 필드 이름 변경 | **CRITICAL** | 즉시 작업 중단, 우리 zod 스키마 갱신 |
| 응답 필드 타입 변경 | **CRITICAL** | 즉시 작업 중단, 변환 로직 추가 |
| 응답 필드 삭제 | **CRITICAL** | 즉시 작업 중단, 대체 데이터 소스 결정 |
| 인증 방식 변경 | **HIGH** | `INFOHUB_AUTH_TOKEN` 갱신 |
| 앱 URL 변경 | **HIGH** | `.env.local`, `.env.local.example` 갱신 |

### 6.2 우리 측 변경이 InfoHub에 미치는 영향
- 기본적으로 **없음** (우리는 소비자)
- 예외: 우리가 InfoHub에 새로운 사용 패턴을 추가할 때 (예: collect 빈도 증가)
  → InfoHub의 rate limit / 비용에 영향
  → 사전 통지 의무

### 6.3 BW Rank API 변경 시
- 자체 인프라이므로 우리가 컨트롤
- 변경 시 ADR-006의 엔드포인트 5개 영향도 검토 필수

---

## 7. 동기화 도구 (CLI)

### 7.1 InfoHub 스키마 비교 스크립트 (Phase 2)
> Phase 1에서는 수동 점검. Phase 2에서 자동화.

```bash
# scripts/check-infohub-schema.ts (Phase 2)
npm run check:infohub-schema
# → InfoHub의 mcp-server/index.ts에서 도구 시그니처 추출
# → 우리 docs/INFOHUB_INTEGRATION.md §4.1과 비교
# → 차이 있으면 exit 1 (CI 차단)
```

### 7.2 형제 프로젝트 git 상태 점검
```bash
# scripts/check-siblings.sh (Phase 2)
for project in 정보취합-2 naver-keyword정환 buywise-marketing-tool; do
  echo "=== $project ==="
  git -C "C:/개발/$project" log --since="1 week ago" --oneline | head -10
done
```

---

## 8. 위반 사례 및 대응

### 8.1 P-8 위반 시 (응답 스키마 가정)
**증상**: zod 검증 실패, 런타임 크래시
**대응**:
1. 작업 즉시 중단
2. `agents/bugs.md`에 기록 (B-XXX, severity: Critical)
3. InfoHub `mcp-server/index.ts` Read해서 실제 스키마 확인
4. `docs/INFOHUB_INTEGRATION.md` §4.1 갱신
5. 우리 측 zod 스키마 갱신
6. InfoHub 팀에 알림 (의도된 변경인지 확인)
7. `agents/mistakes.md`에 P-8 재발 방지 패턴 기록

### 8.2 InfoHub 코드 무단 수정 시
**증상**: 작업 중 `정보취합-2/` 디렉토리 파일 수정
**대응**:
1. 작업 즉시 중단
2. **수정 내용 git restore** (사용자 승인 필요)
3. 사용자에게 보고: "P-8 위반 — InfoHub 무단 수정"
4. mistakes.md에 기록 (M-XXX)
5. 같은 작업이 InfoHub 변경 없이 가능한지 재설계

### 8.3 응답 스키마 변경 미감지
**증상**: 사용자가 "InfoHub 데이터 이상해"라고 보고
**대응**:
1. InfoHub 측 최근 commit 확인 (`git log -- mcp-server/`)
2. 우리 측 마지막 zod 스키마 검증 시점 확인
3. 그 사이 InfoHub 변경이 있었으면 P-8 위반 가능성
4. mistakes.md에 "정기 점검 누락" 패턴 기록 + 자동화 검토

---

## 9. 자주 묻는 시나리오 (FAQ)

### Q: InfoHub에 새 도구가 추가됐다. 사용해야 하나?
**아니오. 명시적 결정 후만.** 새 도구 사용은 다음 절차:
1. 사용자에게 활용 의사 확인
2. 새 ADR 작성 (ADR-011 보완)
3. `agents/infohub.md` 패턴 추가
4. `docs/INFOHUB_INTEGRATION.md` §3 시나리오 추가

### Q: InfoHub가 응답 필드를 추가했다. 우리는 뭘 해야 하나?
**기본적으로 아무것도 안 해도 된다.** zod 스키마는 unknown 필드를 무시하기 때문.
다만 그 필드가 BUYWISE에 유용해 보이면 활용 검토.

### Q: InfoHub가 다운됐다. 우리 작업 어떻게?
1. **빈 결과 반환 금지 (P-1)**
2. 사용자에게 즉시 보고
3. InfoHub 데이터 없이 진행 가능한 작업이면 ❓ unknown 마크로 진행
4. 진행 불가능한 작업은 중단 + 사용자 결정 대기

### Q: naver-keyword정환에서 알고리즘이 바뀌었다.
**자동 동기화 금지.** 사용자 명시적 결정 후만 포팅.
1. 변경 내용 검토
2. ADR-008 갱신 필요성 판단
3. 사용자 승인 후 새 ADR 작성 + 코드 갱신

### Q: 형제 프로젝트의 환경변수와 우리가 충돌한다.
**우리 변수에 prefix 추가.** 예: `INFOHUB_*` (InfoHub의 변수와 구분).
공유 변수(예: `SUPABASE_URL`)는 각 프로젝트가 자체 Supabase 프로젝트를 가짐.

---

## 10. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| 1.0 | 2026-04-07 | 이재홍 | 최초 작성 (InfoHub + naver-keyword정환 + BW Rank + Coupang Review 동기화 정의) |
