/**
 * 수집 리포트 테스트.
 *
 * 핵심은 "0건"과 "실패"와 "안 함"이 서로 다른 상태로 남는가다 (헌법 P-1).
 */
import { describe, expect, it } from 'vitest';

import { CrawlError } from './errors';
import { isUsableReport, runCrawlSources, summarizeReport } from './report';

describe('runCrawlSources', () => {
  it('성공한 소스의 항목을 모아 준다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'a', run: async () => ['x', 'y'] },
      { name: 'b', run: async () => ['z'] },
    ]);

    expect(report.summary.totalItems).toBe(3);
    expect(report.summary.okSources).toBe(2);
    expect(report.summary.failedSources).toBe(0);
    expect(report.sources['a']?.status).toBe('ok');
    expect(report.gaps).toEqual([]);
  });

  it('0건은 성공이 아니라 empty 이고 gaps 에 남는다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'a', selectorIds: ['x.y'], run: async () => [] },
    ]);

    expect(report.sources['a']?.status).toBe('empty');
    expect(report.summary.okSources).toBe(0);
    expect(report.gaps.join('\n')).toContain('0건');
    expect(report.gaps.join('\n')).toContain('x.y');
  });

  it('0건이 정상인 소스는 emptyIsOk 로 표시할 수 있다', async () => {
    const report = await runCrawlSources<string>(
      '테스트',
      [{ name: 'a', run: async () => [] }],
      { emptyIsOk: ['a'] },
    );

    expect(report.sources['a']?.status).toBe('ok');
    expect(report.gaps).toEqual([]);
  });

  it('한 소스가 던져도 나머지는 계속 간다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      {
        name: 'broken',
        run: async () => {
          throw new CrawlError('session_expired', {
            source: 'broken',
            endpoint: 'e',
            status: 401,
          });
        },
      },
      { name: 'fine', run: async () => ['ok'] },
    ]);

    expect(report.sources['broken']?.status).toBe('error');
    expect(report.sources['broken']?.error).toContain('session_expired');
    expect(report.sources['broken']?.error).toContain('401');
    expect(report.sources['fine']?.status).toBe('ok');
    expect(report.summary.totalItems).toBe(1);
    expect(report.gaps).toHaveLength(1);
  });

  it('에러 메시지에 URL 을 담지 않는다', async () => {
    // 내부 API 는 토큰을 쿼리스트링에 싣기도 한다. 리포트에 URL 이 들어가면
    // 그 토큰이 로그·DB·응답으로 새어 나간다 (P-7).
    const report = await runCrawlSources<string>('테스트', [
      {
        name: 'leaky',
        run: async () => {
          throw new CrawlError('upstream_error', {
            source: 'leaky',
            endpoint: 'search/blog',
            status: 500,
          });
        },
      },
    ]);

    expect(report.sources['leaky']?.error).not.toContain('http');
  });

  it('null 을 돌려주면 skipped 로 기록한다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'nocred', run: async () => null },
    ]);

    expect(report.sources['nocred']?.status).toBe('skipped');
    expect(report.gaps.join('\n')).toContain('연결 정보');
  });

  it('소요 시간을 소스별로 기록한다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'a', run: async () => ['x'] },
    ]);
    expect(report.sources['a']?.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('isUsableReport', () => {
  it('한 소스도 성공하지 못했으면 쓸 수 없다고 본다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'a', run: async () => [] },
    ]);
    expect(isUsableReport(report)).toBe(false);
  });

  it('하나라도 성공하면 쓸 만하다', async () => {
    const report = await runCrawlSources<string>('테스트', [
      { name: 'a', run: async () => [] },
      { name: 'b', run: async () => ['x'] },
    ]);
    expect(isUsableReport(report)).toBe(true);
  });
});

describe('summarizeReport', () => {
  it('소스별 상태와 개수를 한 줄로 보여 준다', async () => {
    const report = await runCrawlSources<string>('발레핏', [
      { name: 'a', run: async () => ['x'] },
      { name: 'b', run: async () => [] },
    ]);
    const line = summarizeReport(report);
    expect(line).toContain('발레핏');
    expect(line).toContain('a=ok(1)');
    expect(line).toContain('b=empty(0)');
  });
});
