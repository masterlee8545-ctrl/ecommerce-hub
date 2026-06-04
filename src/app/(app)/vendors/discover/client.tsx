'use client';

import { useState } from 'react';

import { ExternalLink, Loader2, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';

interface Candidate {
  bizName: string;
  phone: string | null;
  address: string | null;
  categoryName: string | null;
  placeUrl: string | null;
  sourceTitle: string;
  sourceUrl: string;
  sourceBlogger: string | null;
  sourceSnippet: string;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface DiscoverResponse {
  ok: true;
  query: string;
  naverHits: { blog: number; kin: number };
  brandCandidates: string[];
  candidates: Candidate[];
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-navy-50 text-navy-600 border-navy-200',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '★★★ 카카오 검증',
  medium: '★★ 카카오 부분',
  low: '★ 네이버만',
};

export function DiscoverClient() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/vendors/discover?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `검색 실패 (${res.status})`);
        return;
      }
      setResult(json as DiscoverResponse);
      toast.success(`${json.candidates.length}개 후보 발견`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5">
      {/* 검색 폼 */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 고체 탈취제 공급처, 영천 참외 농원, 김치 제조업체"
          className="flex-1 rounded-md border border-navy-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              검색 중...
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              검색
            </>
          )}
        </button>
      </form>

      {/* 에러 */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 결과 */}
      {result && (
        <>
          <div className="rounded-md bg-purple-50 p-3 text-sm text-navy-700">
            <div>
              네이버 검색: 블로그 <strong>{result.naverHits.blog}</strong>건 / 지식인{' '}
              <strong>{result.naverHits.kin}</strong>건
            </div>
            {result.brandCandidates.length > 0 && (
              <div className="mt-1 text-xs">
                <span className="text-navy-500">추출 키워드:</span>{' '}
                {result.brandCandidates.slice(0, 8).map((b) => (
                  <span key={b} className="mr-1 rounded bg-white px-1.5 py-0.5 text-purple-700">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>

          {result.candidates.length === 0 ? (
            <div className="rounded-md border border-dashed border-navy-300 p-8 text-center text-navy-500">
              <p>매칭된 사업장이 없어요.</p>
              <p className="mt-1 text-xs">더 구체적인 키워드로 검색해보세요.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.candidates.map((c, i) => (
                <div key={i} className="rounded-lg border border-navy-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-navy-900">{c.bizName}</h3>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${CONFIDENCE_COLOR[c.confidence]}`}
                        >
                          {CONFIDENCE_LABEL[c.confidence]}
                        </span>
                      </div>
                      {c.categoryName && (
                        <p className="mt-0.5 text-xs text-navy-500">{c.categoryName}</p>
                      )}

                      {/* 전화번호 prominent */}
                      <div className="mt-2 space-y-1">
                        {c.phone && (
                          <a
                            href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                            className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {c.phone}
                          </a>
                        )}
                        {c.address && (
                          <p className="text-xs text-navy-500">📍 {c.address}</p>
                        )}
                      </div>

                      {/* 출처 */}
                      <div className="mt-3 rounded bg-navy-50/50 p-2 text-xs text-navy-600">
                        <div className="flex items-start gap-1">
                          <span className="font-semibold text-navy-700">출처:</span>
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-1 text-blue-600 hover:underline"
                          >
                            {c.sourceTitle}
                          </a>
                        </div>
                        {c.sourceBlogger && (
                          <div className="mt-0.5 text-navy-500">by {c.sourceBlogger}</div>
                        )}
                        <p className="mt-1 line-clamp-2 text-navy-500">{c.sourceSnippet}</p>
                      </div>

                      {c.placeUrl && (
                        <a
                          href={c.placeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-purple-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          카카오맵에서 보기
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
