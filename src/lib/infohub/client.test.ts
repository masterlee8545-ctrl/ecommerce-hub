/**
 * InfoHub REST 클라이언트 단위 테스트
 *
 * 출처: src/lib/infohub/client.ts
 * 헌법: CLAUDE.md §1 P-1 (빈 결과 은폐 금지), §1 P-2 (실패 시 throw),
 *       §1 P-8 (형제 프로젝트 응답 스키마 가정 금지)
 *
 * 검증 항목:
 * 1. clearInfoHubCache — 캐시 초기화 동작
 * 2. searchInfoHubTrends — 환경변수 누락 시 InfoHubCallError(endpoint='config')
 *
 * 주의: 실제 InfoHub 서버를 호출하지 않는다.
 * 통합 테스트(외부 의존)는 별도 e2e suite에서 한다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearInfoHubCache, searchInfoHubTrends } from './client';
import { InfoHubCallError } from './schema';

// ─────────────────────────────────────────────────────────
// 1. 캐시 헬퍼
// ─────────────────────────────────────────────────────────

describe('clearInfoHubCache — 캐시 초기화', () => {
  it('호출이 에러 없이 완료된다', () => {
    expect(() => clearInfoHubCache()).not.toThrow();
  });

  it('여러 번 호출해도 안전', () => {
    clearInfoHubCache();
    clearInfoHubCache();
    expect(() => clearInfoHubCache()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────
// 2. searchInfoHubTrends — 환경변수 누락 케이스
// ─────────────────────────────────────────────────────────

describe('searchInfoHubTrends — 환경변수 누락', () => {
  let savedUrl: string | undefined;
  let savedToken: string | undefined;

  beforeEach(() => {
    savedUrl = process.env['INFOHUB_URL'];
    savedToken = process.env['INFOHUB_AUTH_TOKEN'];
    clearInfoHubCache();
  });

  afterEach(() => {
    // 원래 값 복원 (다른 테스트에 영향 없게)
    if (savedUrl !== undefined) {
      process.env['INFOHUB_URL'] = savedUrl;
    } else {
      delete process.env['INFOHUB_URL'];
    }
    if (savedToken !== undefined) {
      process.env['INFOHUB_AUTH_TOKEN'] = savedToken;
    } else {
      delete process.env['INFOHUB_AUTH_TOKEN'];
    }
    clearInfoHubCache();
  });

  it('INFOHUB_URL이 없으면 config endpoint 에러 throw', async () => {
    delete process.env['INFOHUB_URL'];
    process.env['INFOHUB_AUTH_TOKEN'] = 'dummy-token-for-test';

    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toThrow(InfoHubCallError);
    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toMatchObject({
      endpoint: 'config',
    });
  });

  it('INFOHUB_AUTH_TOKEN이 없으면 config endpoint 에러 throw', async () => {
    process.env['INFOHUB_URL'] = 'https://example.test';
    delete process.env['INFOHUB_AUTH_TOKEN'];

    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toThrow(InfoHubCallError);
    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toMatchObject({
      endpoint: 'config',
    });
  });

  it('둘 다 없으면 InfoHubCallError throw (어느 쪽이든)', async () => {
    delete process.env['INFOHUB_URL'];
    delete process.env['INFOHUB_AUTH_TOKEN'];

    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toThrow(InfoHubCallError);
  });

  it('INFOHUB_URL이 빈 문자열이면 config 에러', async () => {
    process.env['INFOHUB_URL'] = '';
    process.env['INFOHUB_AUTH_TOKEN'] = 'dummy-token';

    await expect(searchInfoHubTrends({ query: 'test' })).rejects.toMatchObject({
      endpoint: 'config',
    });
  });
});
