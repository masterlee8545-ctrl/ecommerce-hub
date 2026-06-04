/**
 * 외부 공급처 발굴 — 네이버 + 카카오 통합
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §2.5번 PR
 * ADR: ADR-012 (vendors), ADR-013 (회사 격리)
 *
 * 흐름:
 *   1. 네이버 블로그 / 지식인 검색 → 글 본문에서 업체명/브랜드 후보 추출
 *   2. 카카오 로컬로 각 후보의 정확한 전화번호 + 주소 검증
 *   3. 후보 카드 (체크박스) → "vendors INSERT"
 */
import { kakaoKeywordSearch, type KakaoLocalPlace } from './kakao-local';
import { naverMultiSearch, type NaverSearchItem } from './naver-search';

export interface ExternalCandidate {
  /** 카카오에서 매칭된 사업장 (있으면) */
  bizName: string;
  phone: string | null;
  address: string | null;
  categoryName: string | null;
  placeUrl: string | null;
  /** 네이버 블로그 등 출처 글 */
  sourceTitle: string;
  sourceUrl: string;
  sourceBlogger: string | null;
  sourceSnippet: string;
  /** 네이버 검색에서 매칭된 brand keywords */
  matchedKeywords: string[];
  /** 신뢰도 */
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoverResult {
  query: string;
  naverHits: {
    blog: number;
    kin: number;
  };
  brandCandidates: string[];
  candidates: ExternalCandidate[];
}

/**
 * 블로그 글 description 에서 브랜드명/업체명 후보 추출.
 *
 * 간단한 휴리스틱:
 *   - 따옴표 안의 텍스트 (예: "메이드센트" 추천)
 *   - "○○○ 추천", "○○○ 사용해보니" 패턴
 *   - 2~10자 한글 + 영문 혼합 단어
 *
 * 정확한 추출은 Claude API 활용 가능하지만 일단 휴리스틱 버전.
 */
function extractBrandCandidates(items: NaverSearchItem[]): string[] {
  const counts = new Map<string, number>();
  const stopwords = new Set([
    '추천', '리뷰', '후기', '사용', '제품', '상품', '구매', '판매', '직구',
    '쇼핑', '특가', '할인', '브랜드', '본사', '회사', '업체',
  ]);

  for (const it of items) {
    const text = `${it.title} ${it.description}`;

    // 패턴 1: 따옴표 안
    const quoted = [...text.matchAll(/['"“”]([가-힣A-Za-z]{2,15})['"“”]/g)];
    for (const m of quoted) {
      const w = m[1];
      if (w && !stopwords.has(w)) {
        counts.set(w, (counts.get(w) ?? 0) + 2); // 따옴표는 가중
      }
    }

    // 패턴 2: "X 추천" / "X 후기" 패턴 (X 가 2~10자 한글/영문)
    const recoPat = [...text.matchAll(/([가-힣A-Za-z]{2,10})\s*(?:추천|후기|리뷰)/g)];
    for (const m of recoPat) {
      const w = m[1];
      if (w && !stopwords.has(w)) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }

  // 빈도순 정렬, 상위 10개
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

export async function discoverExternalVendors(query: string): Promise<DiscoverResult> {
  // 1) 네이버 블로그 + 지식인 검색
  const naver = await naverMultiSearch(query, ['blog', 'kin']);

  const blogItems =
    'items' in (naver.blog ?? {}) ? (naver.blog as { items: NaverSearchItem[] }).items : [];
  const kinItems =
    'items' in (naver.kin ?? {}) ? (naver.kin as { items: NaverSearchItem[] }).items : [];
  const allItems = [...blogItems, ...kinItems];

  // 2) 브랜드 후보 추출
  const brands = extractBrandCandidates(allItems);

  // 3) 각 브랜드를 카카오 로컬로 검증
  const candidates: ExternalCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const brand of brands.slice(0, 5)) {
    // 카카오 로컬 검색
    let kakaoPlaces: KakaoLocalPlace[] = [];
    try {
      const kakao = await kakaoKeywordSearch({ query: brand, size: 3 });
      kakaoPlaces = kakao.documents;
    } catch (e) {
      console.warn(`[discover] 카카오 ${brand} 실패:`, e instanceof Error ? e.message : e);
    }

    if (kakaoPlaces.length > 0) {
      // 카카오에서 매칭됨 — 정확한 사업장 정보
      for (const place of kakaoPlaces.slice(0, 2)) {
        const key = `${place.place_name}|${place.phone}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // 네이버 어느 글에서 이 브랜드 나왔는지
        const sourceItem = allItems.find((it) =>
          `${it.title} ${it.description}`.includes(brand),
        );

        candidates.push({
          bizName: place.place_name,
          phone: place.phone || null,
          address: place.road_address_name || place.address_name || null,
          categoryName: place.category_name || null,
          placeUrl: place.place_url || null,
          sourceTitle: sourceItem?.title ?? `${query} 검색`,
          sourceUrl: sourceItem?.link ?? '',
          sourceBlogger: sourceItem?.bloggername ?? null,
          sourceSnippet: sourceItem?.description ?? '',
          matchedKeywords: [brand],
          confidence: place.phone ? 'high' : 'medium',
        });
      }
    } else {
      // 카카오에 없음 — 네이버 글만 있는 상태
      const sourceItem = allItems.find((it) =>
        `${it.title} ${it.description}`.includes(brand),
      );
      if (!sourceItem) continue;

      const key = `brand:${brand}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      candidates.push({
        bizName: brand,
        phone: null,
        address: null,
        categoryName: null,
        placeUrl: null,
        sourceTitle: sourceItem.title,
        sourceUrl: sourceItem.link,
        sourceBlogger: sourceItem.bloggername ?? null,
        sourceSnippet: sourceItem.description,
        matchedKeywords: [brand],
        confidence: 'low',
      });
    }
  }

  return {
    query,
    naverHits: { blog: blogItems.length, kin: kinItems.length },
    brandCandidates: brands,
    candidates,
  };
}
