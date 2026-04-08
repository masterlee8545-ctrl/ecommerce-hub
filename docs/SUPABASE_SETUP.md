# Supabase 연결 가이드 (BUYWISE.CO 전용)

> **목표**: 이 문서를 따라 30분 안에 빈 Supabase 프로젝트를 만들고, 우리 시스템을 연결하고, 21개 표를 만들고, 시드 데이터를 채워 넣는다.
>
> **대상**: 비개발자도 단계별로 따라 할 수 있게 작성됨.
>
> **예상 소요**: 20~30분

---

## 0. 미리 알아둘 단어

| 용어 | 쉬운 설명 |
|---|---|
| **Supabase** | 우리가 쓰는 데이터베이스 호스팅 서비스. PostgreSQL을 인터넷에서 빌려 쓰는 것. |
| **프로젝트** | Supabase에서 데이터베이스 1개를 담는 그릇. 회사별로 따로 만들 수도 있고, 1개에 모아 쓸 수도 있음 (우리는 1개에 모음). |
| **연결 문자열 (Connection String)** | 우리 코드가 데이터베이스에 들어갈 때 쓰는 주소+비밀번호. `postgresql://...` 로 시작함. |
| **마이그레이션 (Migration)** | "데이터베이스 안에 표를 만드는 작업". 우리는 SQL 파일로 21개 표를 한 번에 만든다. |
| **시드 (Seed)** | "처음 한 번만 채워 넣는 기본 데이터". 회사 3개 + 관세 12개 + 관리자 1명. |
| **풀러 (Pooler)** | 동시 연결 100개를 효율적으로 나눠 쓰는 중간 다리. Vercel 같은 서버리스 환경에서는 풀러를 써야 함. |
| **Direct Connection vs Pooled Connection** | 직접 연결(5432 포트)은 마이그레이션용, 풀러 연결(6543 포트)은 일반 앱용. 둘 다 .env.local에 적어둠. |

---

## 1. Supabase 프로젝트 만들기

### 1-1. 가입/로그인
1. https://supabase.com 에 접속
2. **Start your project** 클릭
3. GitHub 또는 구글 계정으로 로그인 (BUYWISE 공용 계정 권장)

### 1-2. 새 프로젝트 생성
1. 대시보드 좌측 상단의 **New project** 클릭
2. 입력값:
   - **Name**: `buywise-ecommerce-hub`
   - **Database Password**: 강력한 비밀번호 (예: `Bw!2026Hub#Strong`) — **반드시 1Password에 저장**
   - **Region**: `Northeast Asia (Seoul)` — 한국 사용자에게 가장 빠름
   - **Pricing Plan**: Free (월 500MB까지 무료)
3. **Create new project** 클릭
4. 약 2분 대기 (프로젝트 준비 중)

### 1-3. 연결 문자열 가져오기
1. 프로젝트 대시보드 → 좌측 메뉴 **Project Settings** (톱니바퀴) → **Database**
2. **Connection string** 섹션에서 두 종류 모두 복사:
   - **URI** (Direct connection, 포트 5432) → 마이그레이션·시드용
   - **Connection pooling** 탭의 **Transaction** 모드 (포트 6543) → 앱 런타임용
3. 둘 다 비밀번호 부분 `[YOUR-PASSWORD]` 을 1-2에서 정한 실제 비밀번호로 교체

> **두 개를 따로 쓰는 이유**:
> - 마이그레이션은 트랜잭션 전체를 길게 잡고 DDL을 실행해야 해서 직접 연결(5432) 필요.
> - 앱 런타임은 동시 요청 100개를 받아야 해서 풀러(6543) 필수. Vercel/Edge 환경에서는 직접 연결하면 연결 풀이 폭발함.

---

## 2. .env.local 파일 설정

프로젝트 루트의 `.env.local` 파일을 다음과 같이 수정:

```bash
# ─────────────────────────────────────────────
# Supabase 데이터베이스 연결
# ─────────────────────────────────────────────

# 앱 런타임용 (포트 6543, Transaction Pooling, prepare=false)
DATABASE_URL=postgresql://postgres.[프로젝트 ID]:[비밀번호]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres

# 마이그레이션·시드용 (포트 5432, Direct Connection)
DATABASE_URL_DIRECT=postgresql://postgres:[비밀번호]@db.[프로젝트 ID].supabase.co:5432/postgres

# ─────────────────────────────────────────────
# Supabase REST API (선택 — 추후 클라이언트에서 사용)
# ─────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://[프로젝트 ID].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[Project Settings → API → anon public]

# ─────────────────────────────────────────────
# NextAuth
# ─────────────────────────────────────────────
# 최소 32바이트 랜덤 문자열. 생성: openssl rand -base64 32
AUTH_SECRET=[랜덤 32바이트]

# ─────────────────────────────────────────────
# 시드 관리자 비밀번호 (선택, 없으면 BUYWISE!2026 기본값)
# ─────────────────────────────────────────────
SEED_ADMIN_PASSWORD=[원하는 강력한 비밀번호]
```

> **AUTH_SECRET 만드는 방법** (Windows PowerShell):
> ```powershell
> [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
> ```
> 또는 https://generate-secret.vercel.app/32 에서 생성.

### 환경변수 점검
다음 명령으로 빠진 게 없는지 확인:

```bash
npm run env:check
```

녹색 ✅ 표시가 나오면 OK. ❌ 가 나오면 그 항목을 추가해야 함.

---

## 3. 마이그레이션 실행 (21개 표 + RLS 정책)

```bash
# 1) 21개 표를 생성하는 SQL 적용
npm run db:migrate

# 2) RLS 정책 SQL을 직접 적용 (drizzle-kit이 자동 적용 안 하는 형태라 별도 실행)
psql "$env:DATABASE_URL_DIRECT" -f drizzle/migrations/0001_rls_policies.sql
```

> **psql이 없으면**: Supabase 대시보드의 **SQL Editor**에서 `0001_rls_policies.sql` 파일 내용을 복사 → 붙여넣기 → **Run** 클릭.

### 마이그레이션 성공 확인
Supabase 대시보드 → **Table Editor** 에서 다음 표가 보이면 성공:

```
✅ companies (3행 — 시드 후)
✅ users (1행 — 시드 후)
✅ user_companies (3행 — 시드 후)
✅ products (0행)
✅ ... 총 21개 표
```

---

## 4. 시드 데이터 입력

```bash
npm run db:seed
```

성공하면 콘솔 마지막에 다음이 출력됨:

```
[seed] 완료 ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  로그인 정보 (최초 1회용 — 즉시 변경 권장)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  이메일:   admin@buywise.co
  비밀번호: BUYWISE!2026   (또는 SEED_ADMIN_PASSWORD 설정값)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> **중요**: 위 비밀번호는 **즉시 변경**하세요. 운영 환경에서는 반드시 `SEED_ADMIN_PASSWORD` 환경변수를 설정한 뒤 시드를 돌리세요.

---

## 5. 첫 로그인 테스트

```bash
npm run dev
```

브라우저에서 http://localhost:3002 접속:
1. `/login` 으로 자동 리디렉션
2. `admin@buywise.co` + 비밀번호 입력
3. 홈 대시보드(`/`)로 이동되면 ✅ 성공

---

## 6. 자주 발생하는 문제

### 6-1. `connection refused` 또는 `getaddrinfo ENOTFOUND`
- 원인: DATABASE_URL이 잘못됐거나 Supabase 프로젝트가 일시정지됨
- 해결:
  1. Supabase 대시보드에서 프로젝트가 활성 상태인지 확인 (Free tier는 7일 미사용 시 일시정지)
  2. Project Settings → Database에서 연결 문자열 다시 복사

### 6-2. `permission denied for schema public`
- 원인: 일반 풀러 연결로 마이그레이션을 시도함
- 해결: 마이그레이션은 반드시 `DATABASE_URL_DIRECT` (5432 포트)로 실행

### 6-3. `relation "companies" does not exist`
- 원인: 마이그레이션이 적용되지 않음
- 해결: `npm run db:migrate` 다시 실행. 그래도 안 되면 SQL Editor에서 `drizzle/migrations/0000_oval_colonel_america.sql` 을 직접 실행

### 6-4. 로그인은 되는데 데이터가 안 보임
- 원인: RLS 정책이 너무 엄격함 — `app.current_company_id`가 NULL
- 해결: 미들웨어/서버 컴포넌트에서 `withCompanyContext()`를 통과했는지 확인

### 6-5. `Tenant or user not found`
- 원인: 풀러 연결 시 사용자 이름을 잘못 적음
- 해결: 풀러 연결의 사용자는 `postgres.[프로젝트 ID]` 형식이어야 함 (마침표 주의)

---

## 7. 운영 환경 전환 시 체크리스트

| # | 항목 | 완료 |
|---|---|---|
| 1 | `SEED_ADMIN_PASSWORD` 환경변수를 안전한 값으로 설정 | ☐ |
| 2 | 시드 직후 admin 비밀번호 즉시 변경 | ☐ |
| 3 | `AUTH_SECRET` 을 운영 전용 새 값으로 교체 | ☐ |
| 4 | Supabase 프로젝트를 **Pro tier**로 업그레이드 (자동 백업·일시정지 방지) | ☐ |
| 5 | Supabase **Connection Pooling → Transaction** 모드 사용 확인 | ☐ |
| 6 | Vercel 환경변수에 `DATABASE_URL`만 등록 (DATABASE_URL_DIRECT는 로컬 전용) | ☐ |
| 7 | RLS 정책이 모든 19개 비즈니스 표에 적용되었는지 SQL로 확인:<br>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;` | ☐ |

---

마지막 갱신: 2026-04-07 (B 단계 완료 직후)
