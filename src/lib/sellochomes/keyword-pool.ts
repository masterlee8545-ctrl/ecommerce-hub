/**
 * 시즌 분석 키워드 풀 로더.
 *
 * 출처: data/season-keyword-pool.json
 * 관리: 형이 직접 JSON 수정 가능 (categories.json 같은 패턴).
 *
 * Worker 는 이 풀을 source of truth 로 보고 셀록홈즈 chart 데이터 자동 갱신.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const POOL_FILE_PATH = join(process.cwd(), 'data', 'season-keyword-pool.json');

interface KeywordPoolFile {
  _meta?: {
    description?: string;
    source?: string;
    count?: number;
  };
  keywords: string[];
}

/**
 * 키워드 풀 전체 로드. 중복 제거됨, 정렬됨.
 *
 * 빈 파일이거나 누락 시 빈 배열.
 */
export async function loadKeywordPool(): Promise<string[]> {
  try {
    const raw = await readFile(POOL_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as KeywordPoolFile;
    if (!Array.isArray(parsed.keywords)) return [];
    // 정규화 — trim + 중복 제거
    const seen = new Set<string>();
    const result: string[] = [];
    for (const kw of parsed.keywords) {
      const trimmed = kw.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
    return result;
  } catch (err) {
    console.warn(
      '[loadKeywordPool] 파일 로드 실패:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** 풀 메타 정보 (UI 표시용) */
export async function getKeywordPoolMeta(): Promise<{
  count: number;
  source: string;
  description: string;
}> {
  try {
    const raw = await readFile(POOL_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as KeywordPoolFile;
    return {
      count: Array.isArray(parsed.keywords) ? parsed.keywords.length : 0,
      source: parsed._meta?.source ?? 'unknown',
      description: parsed._meta?.description ?? '',
    };
  } catch {
    return { count: 0, source: 'unknown', description: '풀 파일 없음' };
  }
}
