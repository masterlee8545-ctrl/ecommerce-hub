/**
 * 세부 (long-tail) 키워드 발굴
 *
 * 형 기준:
 *   - 월 검색량 3,000 ~ 50,000
 *   - 평균리뷰 ≤ 500
 *   - 가격 5천~8만원 (1688 sweet spot)
 *   - 부피 작음
 *   - 비브랜드, 쇼핑성
 *   - long-tail 단어 포함 시 점수 2배
 */
import { fetchAllCategoryKeywords, type SCKeyword } from '../src/lib/sellochomes/client';

interface CatTarget {
  group: '공산품' | '생활용품' | '레저용품';
  path: string;
  id: string;
}

const CATEGORIES: CatTarget[] = [
  { group: '공산품', path: '인테리어소품', id: '50000108' },
  { group: '공산품', path: 'DIY자재', id: '50000107' },
  { group: '공산품', path: '홈데코', id: '50000154' },
  { group: '공산품', path: '베개', id: '50016860' },
  { group: '공산품', path: '커튼/블라인드', id: '50000113' },
  { group: '생활용품', path: '주방용품', id: '50000061' },
  { group: '생활용품', path: '세탁용품', id: '50000062' },
  { group: '생활용품', path: '욕실용품', id: '50000157' },
  { group: '생활용품', path: '의료용품', id: '50000066' },
  { group: '생활용품', path: '발건강용품', id: '50000074' },
  { group: '생활용품', path: '구강위생용품', id: '50000072' },
  { group: '생활용품', path: '안마용품', id: '50000075' },
  { group: '생활용품', path: '냉온/찜질', id: '50000071' },
  { group: '생활용품', path: '자동차용품', id: '50000055' },
  { group: '생활용품', path: '반려동물', id: '50000155' },
  { group: '레저용품', path: '헬스', id: '50000030' },
  { group: '레저용품', path: '요가/필라테스', id: '50000031' },
  { group: '레저용품', path: '자전거', id: '50000161' },
  { group: '레저용품', path: '낚시', id: '50000163' },
  { group: '레저용품', path: '러닝용품', id: '50019439' },
  { group: '레저용품', path: '보호용품', id: '50000050' },
  { group: '레저용품', path: '배드민턴', id: '50000041' },
  { group: '레저용품', path: '테니스', id: '50000042' },
];

const BIG_VOLUME = [
  '판넬', '타일', '도어', '데크', '사이딩', '마루', '바닥재', '벽지', '석고보드',
  '합판', '방부목', '강화마루', '강마루', '템바보드', '폴딩도어', '중문',
  '인조잔디', '잔디', '싱크대', '씽크대', '싱크볼', '세면대', '비데', '변기',
  '욕조', '샤워부스', '욕실장', '파티션',
  '침대', '소파', '식탁', '책상', '옷장', '서랍장', '캐비닛', '책장', '진열장',
  '화장대', '의자', '쇼파', '드레스룸',
  '안마의자', '런닝머신', '트레드밀', '냉장고', '세탁기', '건조기', '에어컨',
  '전기차충전기', '제세동기', '심장충격기',
  '자전거', '자토바이', '오토바이', '스쿠터', '카약', '제트스키', '인라인', '킥보드',
  '픽시', '로드자전거', '미니벨로', '그래블', '디스크휠',
  '스미스머신', '슈로스바', '랫풀다운', '벤치프레스', '파워랙', '천국의계단',
  '바운스번', '점핑머신', '러닝머신',
  '캣타워', '강아지집', '고양이집', '펫하우스', '닭장',
  '텐트', '타프', '캠핑카',
];

const BRAND_WORDS = [
  '루이비통', '샤넬', '구찌', '프라다', '에르메스', '보테가', '발렌시아가', '디올',
  '나이키', '아디다스', '푸마', '뉴발란스', '아식스',
  'pxg', 'qi4d', 'qi10', 'qi35', 'p790', 'sim2', 'v3009', '말본', '타이틀리스트',
  '오딧세이', '제로토크', '랩퍼터', '캘러웨이', '스카티카메론',
  '마리떼', '가니', '칼하트', '폴로', '라코스테',
  'k2', '디스커버리', '노스페이스', '코오롱', '블랙야크', '네파',
  '윌슨', '요넥스', '바볼랏', '헤드', '프린스',
  '닥터마틴', '타미힐피거', '캘빈클라인', '몽클레어',
  'cep', '도티', '제이드', '아레나', '스피도',
  '시마노', '아부가르시아', '메가배스', '다이와',
  '브롬톤', '트렉', '자이언트', '메리다',
  '메피폼', '비렉스', 'lg전자', '삼성전자', '쿠쿠',
  '라포레', '헬로키티', '아이유', '디즈니', '카카오',
  '써마드', '쓰나미', '오투휠스', '버디', '88림',
  '블레이드', '프론투라인', '슈로스바',
  '토마스우버컵', 'gms',
  '야노시호', '스텔로브', '듀오버스터',
];

const APPAREL = [
  '웨어', '바람막이', '점퍼', '패딩', '후드', '맨투맨',
  '트레킹화', '운동화', '슬리퍼',
  '수영복', '비키니', '모노키니', '레깅스',
  '조끼', '셔츠', '티셔츠', '재킷', '코트', '청바지', '니트',
  '음료', '맥주', '소주', '와인', '커피', '라면',
  '핸드폰', '스마트폰', '이어폰', '헤드폰', '카메라',
  '크림', '세럼', '에센스', '로션', '토너', '마스크팩',
  '강아지옷', '고양이옷', '펫의류',
];

const EXCLUDE = [...BIG_VOLUME, ...BRAND_WORDS, ...APPAREL];

// 세부 키워드 표시 단어 (포함 시 점수 2배)
const LONG_TAIL_WORDS = [
  // 신체 부위
  '슬개골', '발목', '손목', '무릎', '발가락', '팔꿈치', '어깨', '허리',
  '종아리', '허벅지', '발등', '복부', '코어', '장요근',
  // 용도/위치
  '차량', '자동차', '휴대용', '운동', '헬스', '골프', '자취', '원룸',
  '사무실', '책상', '화장실', '세면대', '주방',
  // 형태/방식
  '미니', '휴대', '접이', '접이식', '자바라', '슬라이드', '회전', '흡착',
  '자석', '무선', '실리콘', '논슬립', '논슬립',
  // 대상
  '여성용', '남성용', '강아지', '고양이', '어린이', '노인용',
  // 기능
  '항균', '방수', '방한', '방음', '다용도', '자동', '전동',
  '메모리폼', '가습', '쿠션', '보온', '냉감', '거치', '정리',
  // 형 기존 라인업과 유사
  '괄사', '마사지', '보호대', '서포터', '벨트', '교정',
  '필러', '슬라이서', '커터', '커버', '케이스', '파우치', '홀더',
  '클립', '후크', '걸이', '미니',
];

interface ScoredKeyword extends SCKeyword {
  group: string;
  category: string;
  score: number;
  longTailMatches: string[];
}

function shouldExclude(name: string): boolean {
  const l = name.toLowerCase();
  return EXCLUDE.some((w) => l.includes(w.toLowerCase()));
}

function findLongTailWords(name: string): string[] {
  return LONG_TAIL_WORDS.filter((w) => name.includes(w));
}

function scoreKeyword(k: SCKeyword, longTailHits: number): number {
  const m = k.monthlyQcCnt;
  const r = k.c_avgReviewCnt;
  const price = k.c_avgPrice ?? 0;
  // 형 새 기준
  if (m < 3000 || m > 50000) return 0;
  if (r > 500) return 0;
  if (k.isBrandKey === 1) return 0;
  if (k.isCommerceKey === 0) return 0;
  if (price < 5000 || price > 80000) return 0;
  let s = m / Math.sqrt(r + 1);
  // long-tail boost
  if (longTailHits > 0) s *= 2 + longTailHits * 0.3;
  // 가격 1만~5만 sweet
  if (price >= 10000 && price <= 50000) s *= 1.3;
  return s;
}

(async () => {
  const all: ScoredKeyword[] = [];
  for (const cat of CATEGORIES) {
    try {
      const kws = await fetchAllCategoryKeywords(cat.id, { maxPages: 12 });
      let passed = 0;
      for (const k of kws) {
        if (shouldExclude(k.keyword)) continue;
        const matches = findLongTailWords(k.keyword);
        const score = scoreKeyword(k, matches.length);
        if (score === 0) continue;
        all.push({ ...k, group: cat.group, category: cat.path, score, longTailMatches: matches });
        passed++;
      }
      console.log(`[${cat.group}/${cat.path}] ${kws.length} → ${passed}`);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.warn(`  실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  const seen = new Set<string>();
  const dedup = all.filter((k) => {
    if (seen.has(k.keyword)) return false;
    seen.add(k.keyword);
    return true;
  });

  const groups: Record<string, ScoredKeyword[]> = { 공산품: [], 생활용품: [], 레저용품: [] };
  for (const k of dedup) groups[k.group]?.push(k);

  console.log(`\n전체 ${dedup.length}개 정제 통과 (long-tail boost 적용)\n`);

  for (const [grp, items] of Object.entries(groups)) {
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, 30);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${grp} 세부 키워드 BEST ${top.length}  (전체 ${items.length}개 중)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(
      '#  | keyword              | 카테고리       | 월검색 | 평균리뷰 | 평균가  | 로켓 | long-tail 단어',
    );
    top.forEach((k, i) => {
      const ratio = Math.round(k.c_rocketRatio * 100);
      const ltMatch = k.longTailMatches.length > 0 ? `[${k.longTailMatches.slice(0, 2).join(',')}]` : '';
      console.log(
        `${(i + 1).toString().padStart(2)} | ${k.keyword.padEnd(18)} | ${k.category.padEnd(12)} | ${k.monthlyQcCnt.toLocaleString().padStart(6)} | ${k.c_avgReviewCnt.toLocaleString().padStart(5)} | ${(k.c_avgPrice?.toLocaleString() ?? '-').padStart(7)} | ${ratio.toString().padStart(3)}% | ${ltMatch}`,
      );
    });
  }

  process.exit(0);
})().catch((e) => {
  console.error('치명적:', e instanceof Error ? e.message : e);
  process.exit(1);
});
