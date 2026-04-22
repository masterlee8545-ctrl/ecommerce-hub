# ItemScout MCP 서버

아이템스카우트 카테고리/키워드/트렌드를 Claude 에게 직접 노출하는 MCP 서버.
웹 앱과 **같은 토큰 소스**(`.data/itemscout-token.json` 또는 `ITEMSCOUT_TOKEN`)를
사용해서, 설정 화면에서 한 번 저장하면 Claude 에서도 그대로 쓸 수 있다.

---

## 제공 툴 (4개)

| 툴 이름                    | 입력                               | 용도                                          |
| -------------------------- | ---------------------------------- | --------------------------------------------- |
| `itemscout_categories`     | (없음)                             | 쿠팡 대분류 15개                              |
| `itemscout_subcategories`  | `parentId: number`                 | 특정 카테고리의 하위 목록 (`is_leaf=1` 이 리프) |
| `itemscout_keywords`       | `categoryId: number, topN?=30`     | 리프 카테고리의 상위 키워드 + 쿠팡 경쟁 데이터 |
| `itemscout_trending`       | (없음)                             | 전체 실시간 트렌딩 상위 키워드                |

입력 스키마는 Zod 로 검증되며, Claude 가 `tools/list` 했을 때 JSON Schema 로
노출된다. `topN` 은 1~500, 기본 30.

---

## 토큰 (3단계 폴백, 웹앱과 동일)

1. `.data/itemscout-token.json` 의 `{ "token": "..." }` — 웹앱 설정 화면이 저장하는 파일
2. `ITEMSCOUT_TOKEN` 환경변수

토큰이 없으면 서버는 부팅은 되지만, 툴 호출 시 명시 에러를 반환한다
(`아이템스카우트 토큰이 설정되지 않았습니다...`).

---

## 시나리오 1: 이 저장소에서 쓰는 Claude (프로젝트 스코프)

**이미 설정됨.** 저장소 루트의 `.mcp.json` 이 `itemscout` 서버를 선언한다.

```jsonc
// C:\개발\ecommerce-hub\.mcp.json
{
  "mcpServers": {
    "itemscout": {
      "command": "node",
      "args": ["mcp-servers/itemscout/server.mjs"],
      "env": {}
    }
  }
}
```

Claude Code 가 이 프로젝트를 열 때 자동으로 붙는다.
(프로젝트 스코프 MCP 는 첫 실행 때 사용자 승인을 요구한다 — 승인하면 이후 자동 연결.)

**토큰 준비 방법 (둘 중 하나)**:

- 웹앱 실행 → "설정 → 아이템스카우트 연결" 에서 토큰 저장
  → `.data/itemscout-token.json` 생성됨 → Claude 도 바로 사용 가능
- 또는 `.env.local` 에 `ITEMSCOUT_TOKEN=...` 추가

---

## 시나리오 2: 다른 프로젝트의 Claude 에서 이 서버 쓰기 (같은 머신)

다른 워크스페이스에서 `cwd` 가 `ecommerce-hub` 가 아니면, 상대경로가 깨진다.
**절대경로 + 토큰 env** 를 박아주면 된다.

해당 프로젝트의 `.mcp.json` 또는 `~/.claude.json` 에 추가:

```jsonc
{
  "mcpServers": {
    "itemscout": {
      "command": "node",
      "args": ["C:/개발/ecommerce-hub/mcp-servers/itemscout/server.mjs"],
      "env": {
        "ITEMSCOUT_TOKEN": "<토큰값>"
      }
    }
  }
}
```

또는 사용자 스코프 한 번에 등록 (모든 프로젝트에서 보임):

```bash
claude mcp add --scope user itemscout \
  node "C:/개발/ecommerce-hub/mcp-servers/itemscout/server.mjs" \
  -e ITEMSCOUT_TOKEN=<토큰값>
```

> 주의: 서버 파일이 `ecommerce-hub` 내부의 `.data/itemscout-token.json` 을 먼저 찾기 때문에,
> 같은 머신이면 env 를 주지 않아도 웹앱이 저장한 토큰이 자동으로 발견된다.
> 다른 머신이라면 반드시 `ITEMSCOUT_TOKEN` env 또는 토큰 파일을 직접 제공해야 한다.

---

## 시나리오 3: 다른 머신의 Claude 에서 쓰기

서버가 stdio 기반이라 **파일 복사 + Node.js** 만 있으면 끝.

1. `mcp-servers/itemscout/` 디렉토리 전체를 대상 머신의 원하는 위치에 복사
   (또는 레포 클론).
2. 해당 위치에서 `npm install @modelcontextprotocol/sdk zod` 한 번 실행
   (레포 클론했으면 `npm install` 로 충분).
3. `.mcp.json` 에 **절대경로 + 토큰 env** 로 등록:

```jsonc
{
  "mcpServers": {
    "itemscout": {
      "command": "node",
      "args": ["/Users/foo/workspace/ecommerce-hub/mcp-servers/itemscout/server.mjs"],
      "env": {
        "ITEMSCOUT_TOKEN": "<그 머신에서 유효한 토큰>"
      }
    }
  }
}
```

> 각 머신마다 **자기 계정의 i_token 쿠키** 가 필요하다. 토큰은 공유하지 말고
> 각자 아이템스카우트 로그인 후 DevTools → Application → Cookies 에서 `i_token` 을 복사.

---

## 시나리오 4: 다른 에이전트 (Claude Desktop 등) 에서 쓰기

Claude Code 외에도 stdio MCP 를 지원하는 클라이언트는 모두 동일하게 붙는다.
Claude Desktop 의 경우 `claude_desktop_config.json` 에:

```jsonc
{
  "mcpServers": {
    "itemscout": {
      "command": "node",
      "args": ["C:/개발/ecommerce-hub/mcp-servers/itemscout/server.mjs"],
      "env": { "ITEMSCOUT_TOKEN": "<값>" }
    }
  }
}
```

---

## 디버깅

**핸드셰이크 테스트** (서버가 정상 부팅/응답하는지):

```bash
cd C:/개발/ecommerce-hub
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'; \
 echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'; \
 echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}') \
| node mcp-servers/itemscout/server.mjs
```

정상이면 `serverInfo: { name: "itemscout", version: "0.1.0" }` 와 4개 툴 목록이 나와야 한다.

**토큰 테스트** (실제 API 호출까지):

```bash
ITEMSCOUT_TOKEN=xxx node -e "
  import('./mcp-servers/itemscout/server.mjs');
" &
# 또는 Claude Code 내에서 itemscout_categories 호출
```

---

## 워크플로 예시

1. `itemscout_categories` → 대분류 목록, `id` 기억
2. `itemscout_subcategories(parentId)` 반복하며 `is_leaf=1` 발견할 때까지 내려감
3. `itemscout_keywords(categoryId, topN=50)` → 상위 50개 + 쿠팡 경쟁 지표
4. 또는 `itemscout_trending` 으로 전체 상승세 키워드부터 시작

Claude 는 이 툴들을 체이닝해서 "특정 카테고리의 저경쟁 키워드 Top 10" 같은
질문에 바로 답할 수 있다.
