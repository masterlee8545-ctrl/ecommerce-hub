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

/** 풀 파일을 못 읽거나 모양이 다를 때. 조용한 빈 배열 대신 이걸 던진다 (P-1). */
export class KeywordPoolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[keyword-pool] ${message} (${POOL_FILE_PATH})`, cause !== undefined ? { cause } : undefined);
    this.name = 'KeywordPoolError';
  }
}

/**
 * 키워드 풀 전체 로드. trim + 중복 제거.
 *
 * 파일이 없거나 깨졌으면 **던진다.**
 *
 * 예전에는 어떤 실패든 빈 배열을 돌려줬다. 그러면 워커가 "0건 처리 완료" 로
 * 정상 종료해, 풀 파일이 사라진 사실을 아무도 모른 채 시즌 분석이 멈춘다.
 * 빈 풀(`keywords: []`)은 정상값이므로 그때만 빈 배열을 돌려준다.
 */
export async function loadKeywordPool(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(POOL_FILE_PATH, 'utf-8');
  } catch (err) {
    throw new KeywordPoolError('키워드 풀 파일을 읽지 못했습니다', err);
  }

  let parsed: KeywordPoolFile;
  try {
    parsed = JSON.parse(raw) as KeywordPoolFile;
  } catch (err) {
    throw new KeywordPoolError('키워드 풀 파일이 올바른 JSON 이 아닙니다', err);
  }

  if (!Array.isArray(parsed.keywords)) {
    throw new KeywordPoolError('키워드 풀 파일에 keywords 배열이 없습니다');
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of parsed.keywords) {
    const trimmed = typeof kw === 'string' ? kw.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
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
