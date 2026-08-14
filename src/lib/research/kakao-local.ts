/**
 * 카카오 로컬 API — 장소 검색 (사업장 + 연락처 + 주소)
 *
 * 출처: https://developers.kakao.com/docs/latest/ko/local/dev-guide
 * 헌법: CLAUDE.md §1 P-2/P-7
 * ADR: 2.5번 PR (외부 공급처 서칭)
 *
 * 인증: Authorization: KakaoAK {REST_API_KEY}
 * 한도: 일 30만 회 무료
 *
 * ADR: docs/ADR-014.md — 공통 fetch + 응답 계약.
 * 공식 API 라 브라우저 위장은 하지 않는다. 공통 fetch 를 쓰는 건
 * 재시도·타임아웃·응답 계약을 다른 수집원과 같은 규칙으로 맞추기 위해서다.
 */
// 배럴 대신 필요한 모듈만 (배럴은 금고→DB 와 cheerio 까지 끌고 온다)
import { crawlFetchJson, type HeaderProfile } from '@/lib/crawl/fetch';

const KAKAO_LOCAL_API = 'https://dapi.kakao.com/v2/local/search';

/** 카카오 로컬 한 페이지 최대 개수. */
const DEFAULT_SIZE = 15;

const KAKAO_PROFILE: HeaderProfile = {
  origin: null,
  referer: '',
  json: false,
  xhr: false,
  browserLike: false,
};

export interface KakaoLocalPlace {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string; //                       경도
  y: string; //                       위도
  place_url: string;
  distance: string;
}

export interface KakaoLocalResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
    same_name: {
      region: string[];
      keyword: string;
      selected_region: string;
    };
  };
  documents: KakaoLocalPlace[];
}

export interface KakaoKeywordSearchOptions {
  query: string;
  page?: number; //                   1~45
  size?: number; //                   1~15
  category_group_code?: string;
}

export async function kakaoKeywordSearch(
  opts: KakaoKeywordSearchOptions,
): Promise<KakaoLocalResponse> {
  const key = process.env['KAKAO_REST_API_KEY'];
  if (!key) {
    throw new Error('KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const params = new URLSearchParams({
    query: opts.query,
    page: String(opts.page ?? 1),
    size: String(opts.size ?? DEFAULT_SIZE),
  });
  if (opts.category_group_code) params.set('category_group_code', opts.category_group_code);

  const url = `${KAKAO_LOCAL_API}/keyword.json?${params.toString()}`;
  return crawlFetchJson<KakaoLocalResponse>(url, {
    source: 'kakao',
    // URL 에는 검색어가 들어간다. 에러 메시지에는 종류만 남긴다 (P-7)
    endpoint: 'local/search/keyword',
    profile: KAKAO_PROFILE,
    headers: { Authorization: `KakaoAK ${key}` },
    contractId: 'kakao.local_keyword',
  });
}
