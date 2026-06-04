/**
 * 미니멀 RFC 4180 CSV 파서
 *
 * 출처: 자체 작성 (의존성 없음, BUYWISE 크롤링 데이터 형식 대응)
 * 헌법: CLAUDE.md §1 P-2 (실패 시 명시적 에러)
 *
 * 처리:
 *   - UTF-8 BOM 제거
 *   - 쌍따옴표 escape (`""` → `"`)
 *   - 따옴표 안의 콤마/개행 안전
 *   - 첫 줄을 헤더로 자동 인식
 *
 * 한계 (현재 형식 충족, 더 복잡한 CSV는 papaparse 등 라이브러리 권장):
 *   - 줄 끝 CR/LF/CRLF 모두 지원
 *   - 빈 필드는 빈 문자열로 반환 (NULL 변환은 호출자 책임)
 */

export interface ParsedCsv {
  /** 첫 줄 헤더 (BOM/공백 제거) */
  headers: string[];
  /** 데이터 row. 각 row 는 헤더 길이와 동일. 모자라면 빈 문자열로 채움. */
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  if (!text) return { headers: [], rows: [] };

  // UTF-8 BOM 제거
  let content = text;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const fields: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const c = content[i];

    if (inQuotes) {
      if (c === '"') {
        // escape: "" → "
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // 닫는 따옴표
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    // not in quotes
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      current.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      // 줄 끝: 현재 필드/row 마감
      current.push(field);
      fields.push(current);
      current = [];
      field = '';
      // CRLF 처리
      if (c === '\r' && content[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += c;
    i++;
  }

  // 파일 끝의 마지막 row (개행 없이 끝난 경우)
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    fields.push(current);
  }

  if (fields.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = (fields[0] ?? []).map((h) => h.trim());
  const dataRows = fields.slice(1).filter((r) => {
    // 완전 빈 줄은 스킵
    return r.some((cell) => cell.length > 0);
  });

  // 컬럼 길이 정규화 (모자라면 '' 로 채움, 넘치면 잘라냄)
  const normalized = dataRows.map((r) => {
    if (r.length === headerRow.length) return r;
    if (r.length < headerRow.length) {
      const out = [...r];
      while (out.length < headerRow.length) out.push('');
      return out;
    }
    return r.slice(0, headerRow.length);
  });

  return { headers: headerRow, rows: normalized };
}
