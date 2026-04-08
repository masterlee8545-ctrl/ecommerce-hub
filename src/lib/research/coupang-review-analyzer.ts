/**
 * 쿠팡 경쟁 상품 리뷰 분석기 (Anthropic Claude 호출)
 *
 * 출처: docs/SPEC.md §3 Research 단계, ADR-007 (AI 출력은 *_estimated)
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 throw),
 *       §1 P-3 (신뢰도 마킹 강제), §1 P-9 (한국어 사용자 친화)
 *
 * 역할:
 * - 사용자가 쿠팡 상품 페이지에서 복사해 붙여넣은 리뷰 텍스트를 받는다
 * - Anthropic Claude API로 보내 구조화된 인사이트(불만/장점/차별화 포인트)를 추출
 * - zod로 응답 검증 후 반환
 *
 * 멀티테넌트 안전성:
 * - 이 함수 자체는 DB를 건드리지 않음 → company_id 격리 영향 없음
 * - 호출하는 쪽(API 라우트)에서 requireCompanyContext()로 인증만 보장하면 됨
 *
 * 신뢰도 정책 (P-3):
 * - 모든 출력은 confidence: 'estimated' 강제
 * - 회계/원가 계산에 직접 사용 금지 (CLAUDE.md §10.6)
 *
 * ⚠ 호출 비용:
 * - claude-opus-4-5 호출 1회당 약 0.01~0.05 USD (입력 길이에 따라)
 * - 호출 전 입력 길이 가드 (MAX_INPUT_CHARS) 필수
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

/** 입력 텍스트 최대 길이 (약 한국어 8천 자 ≈ Claude 입력 토큰 4천 개) */
const MAX_INPUT_CHARS = 8000;

/** 입력 텍스트 최소 길이 (이보다 짧으면 분석 의미 없음) */
const MIN_INPUT_CHARS = 30;

/** Claude 호출 max_tokens (응답 길이 상한 — 약 한국어 1500자) */
const MAX_OUTPUT_TOKENS = 2000;

/** Claude 호출 timeout (밀리초) */
const ANTHROPIC_TIMEOUT_MS = 60000;

/** 기본 모델 (env 없을 때 폴백) */
const DEFAULT_MODEL = 'claude-opus-4-5';

// ─── 출력 스키마 길이/개수 제한 (no-magic-numbers 회피) ───
const MAX_PRODUCT_HINT_CHARS = 200;
const MAX_INSIGHT_TEXT_CHARS = 300;
const MAX_QUOTE_CHARS = 200;
const MAX_SUMMARY_CHARS = 500;
const MAX_INSIGHT_ARRAY_LEN = 5;
const MAX_DIFFERENTIATOR_CHARS = 200;
const MAX_DIFFERENTIATOR_ARRAY_LEN = 5;
const MAX_REVIEW_COUNT_GUESS = 10000;

// ─────────────────────────────────────────────────────────
// 입력/출력 zod 스키마
// ─────────────────────────────────────────────────────────

/**
 * 분석기 입력.
 * - rawText: 사용자가 붙여넣은 쿠팡 리뷰 원문 (여러 줄, 별점 포함 가능)
 * - productHint: (선택) 상품 이름이나 카테고리 힌트 — 분석 정확도 향상
 */
export const AnalyzeInputSchema = z.object({
  rawText: z
    .string()
    .min(MIN_INPUT_CHARS, `리뷰 텍스트가 너무 짧습니다 (최소 ${MIN_INPUT_CHARS}자).`)
    .max(MAX_INPUT_CHARS, `리뷰 텍스트가 너무 깁니다 (최대 ${MAX_INPUT_CHARS}자).`),
  productHint: z.string().max(MAX_PRODUCT_HINT_CHARS).optional(),
});
export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

/**
 * 단일 인사이트 항목.
 * - text: 인사이트 본문 (한국어 1문장)
 * - frequencyHint: 'high' | 'medium' | 'low' — 리뷰에서 얼마나 자주 등장했는지
 * - quote: (선택) 원문에서 발췌한 짧은 인용
 */
const InsightItemSchema = z.object({
  text: z.string().min(1).max(MAX_INSIGHT_TEXT_CHARS),
  frequencyHint: z.enum(['high', 'medium', 'low']),
  quote: z.string().max(MAX_QUOTE_CHARS).optional(),
});

/**
 * Claude가 반환할 분석 결과.
 * 반드시 JSON 형식으로 응답하도록 system prompt에서 강제한다.
 *
 * confidence는 우리가 사후에 'estimated'로 강제 주입한다 (P-3 — Claude가 잘못 채워도 무시).
 */
export const AnalyzeResultSchema = z.object({
  /** 한국어 1~2문장 종합 평가 */
  overallSummary: z.string().min(1).max(MAX_SUMMARY_CHARS),

  /** 자주 언급된 불만 (최대 5개) */
  topComplaints: z.array(InsightItemSchema).max(MAX_INSIGHT_ARRAY_LEN),

  /** 자주 언급된 장점 (최대 5개) */
  topCompliments: z.array(InsightItemSchema).max(MAX_INSIGHT_ARRAY_LEN),

  /** 우리 상품이 차별화할 수 있는 포인트 (최대 5개) */
  suggestedDifferentiators: z
    .array(z.string().min(1).max(MAX_DIFFERENTIATOR_CHARS))
    .max(MAX_DIFFERENTIATOR_ARRAY_LEN),

  /** 분석한 리뷰 개수 추정 (Claude가 셀 수 없으면 0) */
  estimatedReviewCount: z.number().int().min(0).max(MAX_REVIEW_COUNT_GUESS),

  /** 우리 시스템 표준 신뢰도 — 항상 'estimated' (P-3) */
  confidence: z.literal('estimated'),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResultSchema>;

// ─────────────────────────────────────────────────────────
// 커스텀 에러
// ─────────────────────────────────────────────────────────

/**
 * 분석기 호출 실패 — 네트워크/API 키/타임아웃 등.
 * P-2: try-catch로 빈 결과 반환 금지. 반드시 throw해서 호출자가 알게 한다.
 */
export class CoupangReviewAnalyzerError extends Error {
  public readonly stage: 'config' | 'input' | 'api' | 'parse';

  constructor(message: string, stage: 'config' | 'input' | 'api' | 'parse', cause?: unknown) {
    super(`[CoupangReviewAnalyzer] ${message}`, cause !== undefined ? { cause } : undefined);
    this.name = 'CoupangReviewAnalyzerError';
    this.stage = stage;
  }
}

// ─────────────────────────────────────────────────────────
// Claude system prompt
// ─────────────────────────────────────────────────────────

/**
 * Claude에게 전달할 system 메시지.
 *
 * 핵심 지시:
 * 1. 응답은 반드시 JSON만 (코드 펜스 금지, 설명 금지)
 * 2. 모든 텍스트는 한국어
 * 3. 빈 결과는 빈 배열로 (P-1 — 임의로 채우지 말 것)
 * 4. JSON 스키마 정확히 준수
 */
const SYSTEM_PROMPT = `당신은 한국 이커머스 리서치 전문가다. 사용자가 붙여넣은 쿠팡 경쟁 상품 리뷰 텍스트를 분석해서 우리가 새 상품을 만들 때 차별화할 포인트를 찾는다.

응답 규칙:
1. 반드시 아래 JSON 스키마를 정확히 따른 JSON 객체로만 응답한다. 코드 펜스(\`\`\`)나 설명 텍스트는 절대 포함하지 마라.
2. 모든 문자열은 한국어로 작성한다.
3. 리뷰에서 명확히 확인되지 않는 내용은 절대 지어내지 말고, 해당 배열을 빈 배열([])로 둔다.
4. frequencyHint는 다음 기준으로 판단한다:
   - 'high': 리뷰의 30% 이상에서 언급
   - 'medium': 10~30%
   - 'low': 10% 미만이지만 의미 있는 단일 사례
5. quote는 원문에서 30자 이내로 짧게 발췌하되, 발췌가 어려우면 생략한다.
6. suggestedDifferentiators는 "topComplaints를 해결하는 방법" 위주로 작성한다.
7. confidence 필드는 항상 정확히 "estimated" 문자열로 채운다.

JSON 스키마:
{
  "overallSummary": "문자열 (1~2문장 한국어 종합 평가)",
  "topComplaints": [{ "text": "...", "frequencyHint": "high|medium|low", "quote": "..." }],
  "topCompliments": [{ "text": "...", "frequencyHint": "high|medium|low", "quote": "..." }],
  "suggestedDifferentiators": ["문자열 1", "문자열 2"],
  "estimatedReviewCount": 정수,
  "confidence": "estimated"
}`;

// ─────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────

/**
 * 쿠팡 리뷰 텍스트를 Claude로 분석한다.
 *
 * 동작:
 * 1. 입력 검증 (zod)
 * 2. Anthropic 클라이언트 생성 (API 키 검증)
 * 3. messages.create 호출
 * 4. 응답 텍스트 → JSON 파싱 → zod 검증
 * 5. confidence 필드 강제 'estimated' 주입
 *
 * 에러 처리 (P-2):
 * - API 키 없음 → CoupangReviewAnalyzerError(stage='config')
 * - 입력 검증 실패 → ZodError 그대로 throw (호출자가 422로 변환)
 * - API 호출 실패 → CoupangReviewAnalyzerError(stage='api')
 * - JSON 파싱/스키마 불일치 → CoupangReviewAnalyzerError(stage='parse')
 *
 * @example
 * ```ts
 * const result = await analyzeCoupangReviews({
 *   rawText: '⭐⭐⭐⭐⭐ 정말 좋아요! 배송도 빠르고...',
 *   productHint: '실리콘 주방 용품',
 * });
 * console.log(result.topComplaints);
 * ```
 */
export async function analyzeCoupangReviews(input: AnalyzeInput): Promise<AnalyzeResult> {
  // 1) 입력 검증 — Zod가 throw
  const parsed = AnalyzeInputSchema.parse(input);

  // 2) 환경변수 검증
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey || apiKey.length === 0) {
    throw new CoupangReviewAnalyzerError(
      'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.',
      'config',
    );
  }
  const model = process.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODEL;

  // 3) 사용자 메시지 조립
  const userMessage = buildUserMessage(parsed);

  // 4) Anthropic 호출
  const client = new Anthropic({
    apiKey,
    timeout: ANTHROPIC_TIMEOUT_MS,
  });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    throw new CoupangReviewAnalyzerError(
      `Claude API 호출에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`,
      'api',
      err,
    );
  }

  // 5) 텍스트 블록만 모아서 추출 (Anthropic SDK는 ContentBlock[] 반환)
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (textBlocks.length === 0) {
    throw new CoupangReviewAnalyzerError(
      'Claude 응답에 텍스트 블록이 없습니다.',
      'parse',
    );
  }
  const rawJson = textBlocks.map((b) => b.text).join('').trim();

  // 6) JSON 파싱
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripCodeFence(rawJson));
  } catch (err) {
    throw new CoupangReviewAnalyzerError(
      `Claude 응답이 유효한 JSON이 아닙니다: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
      err,
    );
  }

  // 7) zod 검증 — confidence는 강제 주입 후 검증
  const candidate =
    typeof parsedJson === 'object' && parsedJson !== null
      ? { ...(parsedJson as Record<string, unknown>), confidence: 'estimated' as const }
      : parsedJson;

  const validation = AnalyzeResultSchema.safeParse(candidate);
  if (!validation.success) {
    throw new CoupangReviewAnalyzerError(
      `Claude 응답 스키마가 일치하지 않습니다: ${validation.error.message}`,
      'parse',
      validation.error,
    );
  }

  return validation.data;
}

// ─────────────────────────────────────────────────────────
// 보조 함수
// ─────────────────────────────────────────────────────────

/**
 * 사용자 메시지 텍스트 조립.
 * productHint가 있으면 상단에 표시해서 Claude가 컨텍스트를 잡도록 한다.
 */
function buildUserMessage(input: AnalyzeInput): string {
  const lines: string[] = [];
  if (input.productHint && input.productHint.trim().length > 0) {
    lines.push(`상품 컨텍스트: ${input.productHint.trim()}`);
    lines.push('');
  }
  lines.push('아래는 경쟁 상품의 쿠팡 리뷰 원문이다. 분석해서 JSON으로 응답하라.');
  lines.push('');
  lines.push('--- 리뷰 시작 ---');
  lines.push(input.rawText);
  lines.push('--- 리뷰 끝 ---');
  return lines.join('\n');
}

/**
 * Claude가 가끔 ```json ... ``` 코드 펜스로 감싸서 응답하는 경우 제거.
 */
function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return text;
}
