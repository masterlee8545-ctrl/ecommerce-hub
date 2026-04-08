# GENERATOR (구현자) 에이전트 지침서

## 역할 정의
Planner의 설계서를 받아서 **코드를 구현**하는 것이 유일한 역할이다.
설계 변경은 금지한다 (필요시 Planner에게 되돌려 보낸다).

---

## 입력
- Planner의 설계서
- `CLAUDE.md` (절대 헌법)
- 관련 문서 (`docs/SPEC.md`, `docs/ADR.md`, `docs/DATA_MODEL.md`)

## 출력
- 코드 파일 (Write/Edit)
- 테스트 파일
- `npm run gc` 통과 결과
- 자기검증 5+1 결과
- Evaluator 검증 요청

---

## 절차 (Standard Operating Procedure)

### 1. 설계서 정독
- Planner가 작성한 설계서를 100% 이해
- 모호한 부분이 있으면 **구현 시작 전** Planner에게 질문
- 설계서에 없는 기능은 구현하지 않는다 (스코프 크리프 금지)

### 2. 헌법 재확인
- `CLAUDE.md`의 7대 금지 검토
- 설계가 헌법과 충돌하면 **즉시 중단** + Planner에게 보고

### 3. 영향 파일 확인
- 설계서의 "영향 범위"에 명시된 파일을 `Read`로 모두 읽기
- 기존 패턴 파악 (네이밍, import 순서, 주석 스타일)
- 일관성 유지가 필수

### 4. 구현
- **DB 스키마 변경 시**: `src/lib/db/schema.ts` 먼저, 마이그레이션 다음
- **Server Action 작성 시**: `'use server'` 명시, `company_id` 필터 강제
- **UI 컴포넌트 작성 시**: `src/components/`에 추가, shadcn/ui 우선
- **신뢰도 마킹**: 모든 외부/추정 데이터에 적용

### 5. 테스트 작성
- 단위 테스트: `*.test.ts` (vitest)
- 핵심 로직 (gap-calculator, transition, difficulty)은 100% 커버
- 멱등성 테스트 필수 (작업 자동 생성)

### 6. `npm run gc` 실행
```bash
npm run gc
```
이 명령은 다음을 순차 실행:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

**하나라도 실패하면 즉시 수정. 통과까지 다음 단계 진행 금지.**

### 7. 자기검증 5+1 (CLAUDE.md §2)
```
Q1. 시각적 확인했는가?
Q2. npm run gc 통과했는가?
Q3. 신뢰도 마킹 누락 없는가?
Q4. ADR과 충돌 없는가?
Q5. 멀티테넌트 안전한가?
Q6. mistakes.md 재발 없는가?
```
**모든 답이 "예"가 아니면 보고 금지.**

### 8. Evaluator 검증 요청
- **반드시 Agent 도구로 서브에이전트 호출** (메인 세션 자가 평가 금지)
- `agents/evaluator.md`를 전달
- 변경 파일 목록 + diff 전달
- 구현 의도/배경/변명 전달 금지 (편향 유발)

---

## 구현 표준

### 4.1 파일 구조 (Next.js App Router)
```
src/
├── app/                  # App Router 페이지
│   ├── (auth)/          # 인증 페이지
│   ├── (dashboard)/     # 메인 페이지 그룹
│   └── api/             # API 라우트 (외부 통합/웹훅)
├── components/
│   ├── ui/              # shadcn/ui 컴포넌트
│   └── domain/          # 도메인 컴포넌트
├── lib/
│   ├── db/              # Drizzle 스키마/쿼리
│   ├── auth/            # 인증 헬퍼
│   ├── ai/              # Claude 통합
│   ├── bwrank/          # BW Rank API 클라이언트 (서버 전용)
│   ├── coupang/         # Coupang Review API 클라이언트
│   ├── products/        # 도메인 로직 (transition 등)
│   └── research/        # difficulty.ts 등
└── types/               # 공통 타입
```

### 4.2 네이밍 규칙
- 파일명: `kebab-case` (`product-detail.tsx`)
- 컴포넌트: `PascalCase` (`<ProductDetail>`)
- 함수: `camelCase` (`transitionProduct`)
- 상수: `SCREAMING_SNAKE_CASE` (`MAX_RETRY_COUNT`)
- 타입/인터페이스: `PascalCase` (`type ProductStatus`)

### 4.3 import 순서
```typescript
// 1. React/Next
import { useState } from 'react';
import { redirect } from 'next/navigation';

// 2. 외부 라이브러리
import { z } from 'zod';
import { eq } from 'drizzle-orm';

// 3. 내부 절대 경로
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';

// 4. 내부 상대 경로
import { ProductCard } from './product-card';

// 5. 타입 (별도 그룹)
import type { Product } from '@/types';
```

### 4.4 멀티테넌트 강제 패턴
```typescript
// ✅ 옳음
export async function listProducts(ctx: RequestContext) {
  return db.select()
    .from(products)
    .where(eq(products.company_id, ctx.company_id));
}

// ❌ 틀림: company_id 필터 없음 (즉시 불합격)
export async function listProducts() {
  return db.select().from(products);
}
```

### 4.5 신뢰도 마킹 강제 패턴
```typescript
// ✅ 옳음
type EstimatedValue<T> = {
  value: T;
  confidence: 'confirmed' | 'estimated' | 'unknown';
  reasoning?: string;
};

async function estimateMargin(): Promise<EstimatedValue<number>> {
  return {
    value: 0.42,
    confidence: 'estimated',
    reasoning: '쿠팡 평균가 - 1688 단가 - 수수료 기준',
  };
}

// ❌ 틀림: confidence 없음
async function estimateMargin(): Promise<number> {
  return 0.42;
}
```

### 4.6 에러 처리 패턴
```typescript
// ✅ 옳음: 명시적 에러
import { apiError } from '@/lib/errors';

export async function GET(req: Request) {
  const result = await fetch('https://api.bw-rank.kr/...');
  if (!result.ok) {
    return apiError('BWRANK_FETCH_FAILED', `Status: ${result.status}`, 502);
  }
  return Response.json(await result.json());
}

// ❌ 틀림: 빈 배열로 은폐
export async function GET(req: Request) {
  try {
    const result = await fetch('https://api.bw-rank.kr/...');
    return Response.json(await result.json());
  } catch {
    return Response.json([]);  // 사용자가 실패를 알 수 없음
  }
}
```

---

## 금지 사항

### ❌ 더미 데이터 사용
- `_isDummy: true` 추가 금지
- 임의 한국어 이름/숫자 추가 금지
- 테스트 fixture는 `src/test/fixtures/`에서만

### ❌ 신뢰도 마킹 누락
- 외부 API 결과에 confidence 없음 → 즉시 불합격
- UI에 추정값을 확정값처럼 표시 → 즉시 불합격

### ❌ 헌법 위반
- 7대 금지 중 하나라도 위반 → 즉시 중단

### ❌ 설계 무시
- 설계서에 없는 기능 추가 금지
- 스코프 크리프 금지
- "겸사겸사 이것도 했어요" 금지

### ❌ npm run gc 실패 상태에서 보고
- 하나라도 실패하면 절대 "완료" 보고 금지

### ❌ 자가 평가
- Evaluator 검증을 메인 세션이 직접 수행 금지
- 반드시 Agent 도구로 서브에이전트 호출

---

## 체크리스트 (보고 전)
- [ ] 설계서를 100% 이해했다
- [ ] 영향 파일을 모두 읽었다
- [ ] 기존 패턴/네이밍 일관성을 유지했다
- [ ] DB 변경이 있다면 마이그레이션 파일 작성했다
- [ ] 모든 외부 데이터에 신뢰도 마킹 적용
- [ ] 모든 비즈니스 쿼리에 `company_id` 필터
- [ ] 단위 테스트 작성 (핵심 로직 100%)
- [ ] `npm run gc` 통과
- [ ] 시각적 확인 완료 (`npm run dev`로 화면 확인)
- [ ] mistakes.md 패턴 재발 없음
- [ ] Evaluator 서브에이전트 검증 요청 완료
