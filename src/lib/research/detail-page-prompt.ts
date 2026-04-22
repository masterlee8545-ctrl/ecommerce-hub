/**
 * 상세페이지 기획안 AI 프롬프트 빌더 (Step 4)
 *
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 명시), §1 P-3 (AI 결과 estimated 마킹)
 *
 * 역할:
 * - 상품명, 쿠팡 1페이지 상위 경쟁사 제목, 리뷰 불만 포인트를 모아
 *   "이 상품의 상세페이지를 어떻게 만들면 좋을까" 를 AI 에게 물어보는
 *   프롬프트 문자열을 생성한다.
 *
 * 이 함수는 프롬프트 텍스트만 반환한다 — 실제 Anthropic 호출은 별도 layer.
 * (사용자가 나중에 프롬프트 내용을 직접 튜닝할 수 있도록 분리)
 */

export interface DetailPagePromptInput {
  /** 상품명 */
  productName: string;
  /** 상품 카테고리 (선택) */
  category?: string | null;
  /** 1688/타오바오 소스 URL (선택) */
  cnSourceUrl?: string | null;
  /** 쿠팡 1페이지 상위 경쟁사 제목 (상위 5개 권장) */
  competitorTitles: string[];
  /** 리뷰 분석에서 뽑힌 불만 포인트 (text 배열) */
  complaints: string[];
  /** 리뷰 분석에서 뽑힌 장점 포인트 (text 배열) */
  compliments?: string[];
  /** 사용자가 추가로 넣고 싶은 컨텍스트 */
  extraContext?: string | null;
}

/**
 * 상세페이지 기획안을 요청하는 프롬프트 생성.
 * 사용자가 복사해서 ChatGPT/Claude/Gemini 어디든 붙여넣을 수 있는 형태.
 */
export function buildDetailPagePrompt(input: DetailPagePromptInput): string {
  const {
    productName,
    category,
    cnSourceUrl,
    competitorTitles,
    complaints,
    compliments = [],
    extraContext,
  } = input;

  const competitorBlock = competitorTitles.length > 0
    ? competitorTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
    : '  (아직 쿠팡 1페이지 데이터 없음)';

  const complaintBlock = complaints.length > 0
    ? complaints.map((c) => `  - ${c}`).join('\n')
    : '  (리뷰 분석 결과 아직 없음)';

  const complimentBlock = compliments.length > 0
    ? compliments.map((c) => `  - ${c}`).join('\n')
    : '';

  return [
    `# 상세페이지 기획 요청`,
    ``,
    `아래 정보를 기반으로 "${productName}" 상품의 쿠팡 상세페이지 기획안을 작성해줘.`,
    category ? `카테고리: ${category}` : '',
    cnSourceUrl ? `소스: ${cnSourceUrl}` : '',
    ``,
    `## 쿠팡 1페이지 상위 경쟁사 제목`,
    competitorBlock,
    ``,
    `## 실제 쿠팡 리뷰에서 뽑은 고객 불만 포인트`,
    complaintBlock,
    ``,
    compliments.length > 0 ? `## 고객이 좋아하는 점 (차별화 무기로 안 쓰도록 주의)` : '',
    complimentBlock,
    ``,
    extraContext ? `## 추가 컨텍스트\n${extraContext}\n` : '',
    `## 출력 형식 (JSON)`,
    `다음 구조로 섹션 6~8개 를 만들어줘. sections 배열만 반환.`,
    '```json',
    `[`,
    `  {`,
    `    "position": 0,`,
    `    "title": "섹션 제목 (예: 메인 후킹)",`,
    `    "imageDesc": "어떤 사진이 들어갈지 한 줄 설명 (각도·분위기·색감)",`,
    `    "color": "이 섹션의 색상 톤 (선택)",`,
    `    "copy": "실제 카피 문구 한두 줄",`,
    `    "hook": "이 섹션이 전달하려는 핵심 후킹 포인트 한 줄"`,
    `  }`,
    `]`,
    '```',
    ``,
    `## 지침`,
    `- 위 "고객 불만 포인트" 를 반드시 **2개 이상 섹션**에서 해결책으로 반영할 것.`,
    `- 경쟁사 제목에 공통적으로 없는 차별화 포인트 를 찾아서 메인 후킹에 배치.`,
    `- 한국 쿠팡 유저에게 익숙한 표현 (과장 광고 금지, 법적 문제 없는 카피).`,
    `- "의학적 효능" "최저가" "최고 품질" 같은 절대 표현 금지.`,
    ``,
    `출력은 JSON 배열만. 다른 설명 문장 없이.`,
  ]
    .filter((line) => line !== '' || true) // 빈 줄 허용
    .join('\n');
}
