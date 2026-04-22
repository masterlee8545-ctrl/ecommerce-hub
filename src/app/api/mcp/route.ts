/**
 * /api/mcp — MCP (Model Context Protocol) HTTP 엔드포인트
 *
 * 역할: Claude.ai 웹앱 또는 Claude Code 가 이 엔드포인트에 JSON-RPC 요청 보내면
 *       해당하는 MCP 툴 실행 → 결과 반환.
 *
 * 프로토콜: JSON-RPC 2.0 (MCP 2025-06 Streamable HTTP spec, non-streaming subset)
 *
 * 인증: Authorization: Bearer mcp_<token> 헤더 필수
 *
 * 메서드:
 * - initialize            — 핸드셰이크
 * - notifications/initialized — 클라이언트 초기화 알림 (no response)
 * - tools/list            — 사용 가능한 툴 목록
 * - tools/call            — 툴 실행
 * - ping                  — 헬스 체크
 *
 * 헌법: CLAUDE.md §1 P-2 (명시적 에러), §1 P-4 (멀티테넌트), §1 P-7 (토큰 평문 저장 금지)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { verifyMcpToken } from '@/lib/mcp/auth';
import { findMcpTool, getMcpTools, type McpContext } from '@/lib/mcp/tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = {
  name: 'ecommerce-hub',
  version: '0.1.0',
  title: 'BUYWISE 이커머스 통합관리 MCP',
};

// JSON-RPC 2.0 표준 에러 코드
const RPC_PARSE_ERROR = -32700;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
const RPC_UNAUTHORIZED = -32000; // JSON-RPC 서버 구현 확장 코드 범위

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function rpcSuccess(id: string | number | null, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error: data !== undefined ? { code, message, data } : { code, message } };
}

// ─────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────

async function handleRpc(req: JsonRpcRequest, ctx: McpContext): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Notification (id 없음) — 응답 하지 않음
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case 'initialize': {
        return rpcSuccess(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions:
            '이 MCP 는 BUYWISE 이커머스 통합관리 시스템에 연결됩니다. '
            + '사용자는 바이와이즈·유어밸류·유어옵티멀 3개 법인에서 상품 소싱·마케팅·로켓 입점을 운영 중입니다. '
            + '툴 호출 전 whoami 로 활성 법인 확인 권장.',
        });
      }

      case 'notifications/initialized':
      case 'initialized': {
        // 클라이언트 알림 — 응답 불필요
        return null;
      }

      case 'ping': {
        return rpcSuccess(id, {});
      }

      case 'tools/list': {
        const tools = getMcpTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return rpcSuccess(id, { tools });
      }

      case 'tools/call': {
        const toolName = typeof req.params?.['name'] === 'string' ? req.params['name'] : '';
        const toolArgs =
          typeof req.params?.['arguments'] === 'object' && req.params['arguments'] !== null
            ? (req.params['arguments'] as Record<string, unknown>)
            : {};
        const tool = findMcpTool(toolName);
        if (!tool) {
          return rpcError(id, RPC_INVALID_PARAMS, `존재하지 않는 툴: ${toolName}`);
        }
        try {
          const result = await tool.handler(toolArgs, ctx);
          return rpcSuccess(id, result);
        } catch (toolErr) {
          return rpcSuccess(id, {
            content: [
              {
                type: 'text',
                text: `❌ 툴 실행 실패: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`,
              },
            ],
            isError: true,
          });
        }
      }

      default: {
        if (isNotification) return null;
        return rpcError(id, RPC_METHOD_NOT_FOUND, `지원하지 않는 메서드: ${req.method}`);
      }
    }
  } catch (err) {
    console.error('[/api/mcp] 처리 중 예외:', err);
    return rpcError(
      id,
      RPC_INTERNAL_ERROR,
      err instanceof Error ? err.message : '내부 서버 오류',
    );
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/mcp — JSON-RPC 진입점
// ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = await verifyMcpToken(authHeader);
  if (!token) {
    return NextResponse.json(
      rpcError(null, RPC_UNAUTHORIZED, 'Unauthorized — 유효한 MCP 토큰이 필요합니다.'),
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, RPC_PARSE_ERROR, 'Parse error — 유효한 JSON 이 아닙니다.'), {
      status: 400,
    });
  }

  const ctx: McpContext = {
    userId: token.userId,
    companyId: token.companyId,
    tokenLabel: token.label,
    role: token.role,
  };

  // 배치 요청 (JSON-RPC 2.0 배치) 지원
  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    for (const r of body as JsonRpcRequest[]) {
      const resp = await handleRpc(r, ctx);
      if (resp !== null) responses.push(resp);
    }
    return NextResponse.json(responses);
  }

  const resp = await handleRpc(body as JsonRpcRequest, ctx);
  if (resp === null) {
    // Notification — 204 No Content
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(resp);
}

// ─────────────────────────────────────────────────────────
// GET /api/mcp — 메타정보 (디버깅 / 탐색용)
// ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = await verifyMcpToken(authHeader);
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Unauthorized — Authorization: Bearer mcp_<token> 헤더 필요. '
          + '토큰 발급: /settings/mcp 페이지',
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    serverInfo: SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: getMcpTools().length,
    tokenLabel: token.label,
  });
}
