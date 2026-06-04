/**
 * 카카오 로컬 API — 장소 검색 (사업장 + 연락처 + 주소)
 *
 * 출처: https://developers.kakao.com/docs/latest/ko/local/dev-guide
 * 헌법: CLAUDE.md §1 P-2/P-7
 * ADR: 2.5번 PR (외부 공급처 서칭)
 *
 * 인증: Authorization: KakaoAK {REST_API_KEY}
 * 한도: 일 30만 회 무료
 */

const KAKAO_LOCAL_API = 'https://dapi.kakao.com/v2/local/search';

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
    size: String(opts.size ?? 15),
  });
  if (opts.category_group_code) params.set('category_group_code', opts.category_group_code);

  const url = `${KAKAO_LOCAL_API}/keyword.json?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`카카오 로컬 API ${res.status}: ${text}`);
  }

  return (await res.json()) as KakaoLocalResponse;
}
