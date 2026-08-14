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
// 배럴 대신 필요한 모듈만 (배럴은 금고→DB 와 cheerio 까지 끌고 온다)
import { runCrawlSources } from '@/lib/crawl/report';
import type { SourceOutcome } from '@/lib/crawl/types';

import { kakaoKeywordSearch, type KakaoLocalPlace } from './kakao-local';
import { naverSearch, type NaverSearchItem } from './naver-search';

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
  /**
   * 소스별 수집 상태 (ADR-014).
   *
   * 예전에는 네이버 한쪽이 죽어도 그냥 0건으로 섞여 들어가, 화면에서는
   * "후보가 없네" 로만 보였다. 이제 어느 소스가 왜 비었는지 남는다.
   */
  sources: Record<string, SourceOutcome>;
  /** 못 채운 부분을 사람 말로 (P-3 — UI 는 이걸 ❓ 로 띄우면 된다) */
  gaps: string[];
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

  // 빈도순 정렬, 상위 N 개
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BRAND_CANDIDATES)
    .map(([w]) => w);
}

/** 빈도순으로 남길 브랜드 후보 수. */
const MAX_BRAND_CANDIDATES = 10;
/** 한 번에 검증할 브랜드 후보 수. */
const MAX_BRANDS_TO_VERIFY = 5;
/** 브랜드당 조회할 카카오 장소 수. */
const KAKAO_PLACES_PER_BRAND = 3;
/** 후보 카드로 만들 장소 수. */
const KAKAO_PLACES_TO_KEEP = 2;
/** 네이버에서 한 종류당 가져올 글 수. */
const NAVER_DISPLAY = 10;

export async function discoverExternalVendors(query: string): Promise<DiscoverResult> {
  // 1) 네이버 블로그 + 지식인 검색 — 한쪽이 실패해도 나머지는 계속 간다.
  //    실패는 report 의 sources/gaps 에 그대로 남는다.
  const naverReport = await runCrawlSources<NaverSearchItem>(query, [
    {
      name: 'naver_blog',
      selectorIds: ['naver.search'],
      run: async () =>
        (await naverSearch({ query, type: 'blog', display: NAVER_DISPLAY })).items,
    },
    {
      name: 'naver_kin',
      selectorIds: ['naver.search'],
      run: async () =>
        (await naverSearch({ query, type: 'kin', display: NAVER_DISPLAY })).items,
    },
  ]);

  const blogCount = naverReport.summary.bySource['naver_blog'] ?? 0;
  const kinCount = naverReport.summary.bySource['naver_kin'] ?? 0;
  const allItems = naverReport.items;
  const gaps = [...naverReport.gaps];
  const sources: Record<string, SourceOutcome> = { ...naverReport.sources };

  // 2) 브랜드 후보 추출
  const brands = extractBrandCandidates(allItems);

  // 3) 각 브랜드를 카카오 로컬로 검증
  const candidates: ExternalCandidate[] = [];
  const seenKeys = new Set<string>();
  let kakaoCalls = 0;
  let kakaoFailures = 0;
  let kakaoHits = 0;
  const kakaoStartedAt = Date.now();

  for (const brand of brands.slice(0, MAX_BRANDS_TO_VERIFY)) {
    // 카카오 로컬 검색
    let kakaoPlaces: KakaoLocalPlace[] = [];
    kakaoCalls += 1;
    try {
      const kakao = await kakaoKeywordSearch({ query: brand, size: KAKAO_PLACES_PER_BRAND });
      kakaoPlaces = kakao.documents;
      kakaoHits += kakaoPlaces.length;
    } catch (e) {
      // 예전에는 console.warn 만 하고 넘어가, 카카오가 통째로 죽어도 결과에
      // 흔적이 남지 않았다. 이제 gaps 로 올라간다.
      kakaoFailures += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[discover] 카카오 ${brand} 실패:`, message);
      gaps.push(`카카오 로컬에서 '${brand}' 사업장 정보를 확인하지 못했습니다 — ${message}`);
    }

    if (kakaoPlaces.length > 0) {
      // 카카오에서 매칭됨 — 정확한 사업장 정보
      for (const place of kakaoPlaces.slice(0, KAKAO_PLACES_TO_KEEP)) {
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

  // 카카오는 브랜드마다 부르므로 소스 하나로 묶어 기록한다.
  sources['kakao_local'] = {
    status:
      kakaoCalls === 0
        ? 'skipped'
        : kakaoFailures === kakaoCalls
          ? 'error'
          : kakaoHits > 0
            ? 'ok'
            : 'empty',
    count: kakaoHits,
    error: kakaoFailures > 0 ? `${kakaoCalls}건 중 ${kakaoFailures}건 실패` : null,
    elapsedMs: Date.now() - kakaoStartedAt,
    selectorIds: ['kakao.local_keyword'],
  };

  if (brands.length === 0 && allItems.length > 0) {
    gaps.push(
      `네이버 글 ${allItems.length}건에서 업체명 후보를 뽑지 못했습니다 — 검색어를 좁혀 보세요.`,
    );
  }

  return {
    query,
    naverHits: { blog: blogCount, kin: kinCount },
    brandCandidates: brands,
    candidates,
    sources,
    gaps,
  };
}
