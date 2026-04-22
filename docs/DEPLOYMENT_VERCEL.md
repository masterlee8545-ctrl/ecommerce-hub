# Vercel + Supabase + 로컬 워커 배포 가이드

## 🏗 아키텍처 요약

```
┌─────────────────────────┐      ┌─────────────────────────┐
│  Vercel (웹·API)        │      │  Supabase (Postgres)    │
│  ├─ Next.js 앱            │◀────▶│  ├─ RLS 정책              │
│  ├─ NextAuth 인증          │      │  ├─ scrape_jobs 큐        │
│  └─ 배치 enqueue API       │      │  └─ 전체 도메인 데이터     │
└─────────────────────────┘      └─────────┬───────────────┘
                                           │
                                           │ polling
                                           │
                               ┌───────────▼──────────────┐
                               │  로컬 Windows PC (본인)   │
                               │  ├─ npm run sello:worker │
                               │  └─ Playwright 스크래핑   │
                               └──────────────────────────┘
```

**역할 분담**:
- Vercel: 웹 UI, 인증, 배치 큐 등록, 상태 폴링, 모든 CRUD API
- Supabase: Postgres DB, RLS, 큐 테이블
- 로컬 PC: 스크래핑 (Chrome + Playwright) — Vercel serverless 에서 불가능

---

## 🚀 배포 절차

### 1. Supabase 프로젝트 준비
- 이미 Supabase 사용 중이면 스킵
- 새로 만들 때: Region = Seoul (ap-northeast-2) 권장
- Pooled connection string 복사 (DATABASE_URL)

### 2. Supabase 에 스키마 + 시드 적용
```bash
# 프로덕션 Supabase URL 로 DATABASE_URL 교체한 .env.local 로
npm run db:migrate
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0001_rls_policies
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0002_research_review_analyses
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0003_quotes_krw_vat
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0004_sourcing_workflow
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0005_enable_rls_for_sourcing_workflow
npx tsx --env-file=.env.local scripts/apply-sql-migration.ts 0006_scrape_jobs
npm run db:seed   # 3법인 + admin 계정
```

### 3. Vercel 프로젝트 연결
```bash
npm install -g vercel
vercel link
```
또는 Vercel 대시보드에서 GitHub 연동.

### 4. Vercel 환경변수 설정
Vercel 대시보드 → Project → Settings → Environment Variables 에 아래 전부 추가:

**필수**:
| Key | 값 설명 |
|---|---|
| `DATABASE_URL` | Supabase pooled connection string |
| `DIRECT_URL` | Supabase direct connection (마이그레이션용) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (서버만) |
| `NEXTAUTH_SECRET` | 32자 랜덤 (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |

**선택** (기능별):
| Key | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | 마진 추정·기획서 생성 |
| `COUPANG_REVIEW_API_URL` | 쿠팡 리뷰 분석 |
| `BWRANK_BASE_URL` | BW Rank (있으면) |
| `NAVER_*` | 네이버 데이터랩·검색광고 |

**주의**: `SELLO_*` 는 Vercel 에 **추가하지 말 것** — 로컬 워커 전용.

### 5. 배포
```bash
vercel --prod
```
또는 GitHub push → 자동 배포.

### 6. 로컬 Windows PC 워커 세팅
```bash
# 1) 레포 클론 / 또는 이미 있는 폴더
git clone ... && cd ecommerce-hub
npm install

# 2) .env.local 작성 — Vercel 과 동일한 DATABASE_URL + SELLO_* 변수
# (Supabase 는 같은 DB 를 보기 때문)

# 3) 최초 1회 셀록홈즈 로그인
npm run sello:login
# → Chrome 창 뜸 → 구글/카카오 로그인 → 자동 감지 후 종료

# 4) 워커 상시 실행
npm run sello:worker
# 상시 떠있어야 배치 분석 처리됨
```

### 7. 시작 시 자동실행 (선택)
Windows 작업 스케줄러 / PM2 / NSSM 등으로 부팅 시 자동 실행 가능.

---

## 🧪 배포 후 검증

1. **로그인**: https://your-app.vercel.app → `admin@buywise.co` / `BUYWISE!2026`
2. **3법인 스위처**: 헤더 우측 드롭다운에서 바이와이즈·유어밸류·유어옵티멀 전환
3. **배치 분석**:
   - `/research` → 키워드 체크박스 → 플로팅 툴바 → "일괄 분석 →"
   - 시작 → `?batchId=xxx` URL 로 변경 (이 URL 북마크해두면 나중 복원)
   - 탭 닫고 다시 열어도 진행 상태 복원 ✅
4. **로컬 워커 구동 확인**: PC 의 `npm run sello:worker` 터미널에서 "claim:" 로그 뜨는지
5. **완료**: 통과 키워드 "장바구니에 담기" 클릭 → 3법인 드롭다운에서 선택

---

## 🚧 제약사항

| 기능 | Vercel | 로컬 워커 필요 |
|---|---|---|
| 로그인·CRUD·상품관리·기획서 | ✅ 바로 동작 | ❌ |
| 배치 큐 등록·상태 조회 | ✅ 바로 동작 | ❌ |
| 실제 스크래핑 (키워드 → 메트릭) | ❌ Chrome 불가 | ✅ 필수 |
| `/research/coupang-first-page` 개별 조회 | ⚠ DB 에 데이터 있을 때만 | ✅ 권장 |
| `npm run sello:scrape -- <키워드>` CLI | ❌ | ✅ 필수 |

### `/research/coupang-first-page` 동작
- 로컬 개발: 파일 캐시(`data/sello-scrape/*.json`) 읽음 → 빠름
- Vercel 프로덕션: DB `scrape_jobs.result` 에서 같은 회사·키워드의 최신 done job 가져옴
- 둘 다 없으면 404 + 배치 분석 사용 안내

---

## 🔄 업데이트 시
- 코드 변경 → Vercel 자동 재배포 (GitHub push)
- 로컬 워커 → `git pull && npm install && npm run sello:worker` 재실행
- Supabase 스키마 변경 → `apply-sql-migration.ts 0007_xxx` 실행

---

## ⚠ 알려진 이슈

1. **셀록홈즈 OAuth 세션 만료** — 며칠에 한 번씩 재로그인 필요. `npm run sello:login` 으로 갱신.
2. **Chrome 확장 자동 업데이트** — 버전 폴더가 바뀌면 `resolveExtensionPath()` 가 자동 탐지. 문제 없음.
3. **동시 워커 불가** — 같은 `C:\sello-user-data` 프로필 락 때문. 단일 워커만 허용.
4. **0001_rls_policies.sql 미적용 DB** — 현재 스테이징 DB. 프로덕션은 반드시 RLS 활성화하고 0005 도 함께 적용.
