#!/usr/bin/env node
/**
 * 아이템스카우트 MCP 서버 (stdio)
 *
 * Claude Code에서 아이템스카우트 카테고리/키워드를 직접 조회할 수 있게 한다.
 * 토큰은 ecommerce-hub 프로젝트의 `.data/itemscout-token.json` 혹은
 * `ITEMSCOUT_TOKEN` 환경변수에서 읽는다 (웹 앱과 동일 소스).
 *
 * 제공 툴:
 *   - itemscout_categories        : 대분류 15개
 *   - itemscout_subcategories     : 하위 카테고리
 *   - itemscout_keywords          : 카테고리 내 키워드 (쿠팡 경쟁데이터 포함)
 *   - itemscout_trending          : 트렌딩 키워드 상위
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..'); // ecommerce-hub/
const TOKEN_FILE = join(PROJECT_ROOT, '.data', 'itemscout-token.json');
const BASE_URL = 'https://api.itemscout.io/api';

// ─────────────────────────────────────────────────────────
// 토큰
// ─────────────────────────────────────────────────────────

async function readTokenFile() {
  try {
    const raw = await readFile(TOKEN_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

async function getToken() {
  const fromFile = await readTokenFile();
  if (fromFile) return fromFile;
  const fromEnv = process.env.ITEMSCOUT_TOKEN;
  if (fromEnv) return fromEnv;
  throw new Error(
    '아이템스카우트 토큰이 설정되지 않았습니다.\n' +
      '웹 앱의 "설정 → 아이템스카우트 연결"에서 토큰을 먼저 저장하거나 ' +
      'ITEMSCOUT_TOKEN 환경변수를 설정하세요.',
  );
}

// ─────────────────────────────────────────────────────────
// API 호출
// ─────────────────────────────────────────────────────────

async function fetchIS(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/${path}`, {
    ...options,
    headers: {
      Cookie: `i_token=${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`[itemscout] ${res.status} ${res.statusText}: ${path}`);
  }
  return res.json();
}

async function getTopCategories() {
  const res = await fetchIS('category/coupang_categories_map');
  const all = (res.data || []).flat();
  return all.filter((c) => c.lv === 1);
}

async function getSubcategories(id) {
  const res = await fetchIS(`category/${id}/subcategories`);
  return Array.isArray(res.data) ? res.data : [];
}

async function getCategoryKeywords(id) {
  const res = await fetchIS(`category/${id}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const map = res.data?.data;
  if (!map || typeof map !== 'object') return [];
  return Object.values(map).map((raw) => ({
    keyword: raw.keyword,
    rank: raw.rank,
    monthlySearch: raw.monthly?.total ?? 0,
    productCount: raw.prdCnt ?? 0,
    firstCategory: raw.firstCategory,
    coupangCompetitionRatio: raw.coupang?.coupangCompetitionRatio ?? null,
    coupangCompetitionDesc: raw.coupang?.coupangCompetitionDesc ?? null,
    coupangAveragePrice: raw.coupang?.coupangAveragePrice ?? null,
    coupangAverageReviewCount: raw.coupang?.coupangAverageReviewCount ?? null,
    coupangTotalProductCount: raw.coupang?.coupangTotalProductCount ?? null,
    coupangRocketDeliveryRatio: raw.coupang?.coupangRocketDeliveryRatio ?? null,
  }));
}

async function getTrendingKeywords() {
  const res = await fetchIS('v2/keyword/trend');
  return Array.isArray(res.data) ? res.data : [];
}

// ─────────────────────────────────────────────────────────
// MCP 서버
// ─────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'itemscout', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

function ok(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function fail(err) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `에러: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
  };
}

server.registerTool(
  'itemscout_categories',
  {
    title: '아이템스카우트 대분류 조회',
    description:
      '쿠팡 기준 대분류 카테고리 15개를 반환한다. 각 항목은 { id, n(이름), lv, cid(플랫폼 카테고리ID), il(isLeaf) } 구조.',
    inputSchema: {},
  },
  async () => {
    try {
      const cats = await getTopCategories();
      return ok({ count: cats.length, categories: cats });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'itemscout_subcategories',
  {
    title: '아이템스카우트 하위 카테고리',
    description:
      '주어진 내부 ID의 하위 카테고리 목록. 각 항목은 { id, name, level, is_leaf, category_id, platform }. is_leaf=1이면 더 깊이 없고 바로 키워드 조회 가능.',
    inputSchema: {
      parentId: z
        .number()
        .int()
        .positive()
        .describe('상위 카테고리의 내부 ID (대분류는 itemscout_categories로 조회)'),
    },
  },
  async ({ parentId }) => {
    try {
      const subs = await getSubcategories(parentId);
      return ok({ parentId, count: subs.length, subcategories: subs });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'itemscout_keywords',
  {
    title: '아이템스카우트 카테고리 내 키워드',
    description:
      '리프 카테고리(is_leaf=1)의 상위 키워드와 쿠팡 경쟁 데이터를 반환한다. 기본 상위 30개, topN으로 조절.',
    inputSchema: {
      categoryId: z
        .number()
        .int()
        .positive()
        .describe('리프 카테고리 내부 ID (is_leaf=1 필요)'),
      topN: z
        .number()
        .int()
        .positive()
        .max(500)
        .default(30)
        .describe('상위 몇 개 키워드를 반환할지 (최대 500)'),
    },
  },
  async ({ categoryId, topN }) => {
    try {
      const all = await getCategoryKeywords(categoryId);
      const sliced = all.slice(0, topN);
      const withCoupang = sliced.filter((k) => k.coupangCompetitionRatio != null).length;
      return ok({
        categoryId,
        total: all.length,
        returned: sliced.length,
        withCoupangData: withCoupang,
        keywords: sliced,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'itemscout_trending',
  {
    title: '아이템스카우트 전체 트렌딩',
    description:
      '전 카테고리 실시간 트렌딩 키워드. 각 항목은 { keyword, change(UP/DOWN/STABLE), rank, searchCount, productCount, firstCategory, competitionIntensity }.',
    inputSchema: {},
  },
  async () => {
    try {
      const trends = await getTrendingKeywords();
      return ok({ count: trends.length, trending: trends });
    } catch (e) {
      return fail(e);
    }
  },
);

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
