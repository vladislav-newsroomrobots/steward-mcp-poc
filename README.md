# Steward MCP Server

Local Streamable HTTP MCP server for the Steward ChatGPT PoC — the MCP App that
replaces the Steward Chrome extension as the interface.

Full plan: [`docs/steward-mcp-poc-plan.md`](./docs/steward-mcp-poc-plan.md).
Stage docs: [`docs/steward-chatgpt-mcp-implementation/`](./docs/steward-chatgpt-mcp-implementation/).

## Requirements

- Node.js >= 20.6 (uses `process.loadEnvFile`); developed on 22.x.

## Setup

```bash
npm install
cp .env.example .env   # optional, every value has a default
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | starts the server with reload on change |
| `npm run build` | compiles TypeScript to `dist/` |
| `npm run start` | runs the compiled server |
| `npm run typecheck` | type check without emitting |
| `npm run smoke` | stage 0 acceptance check (run `npm run build` first) |

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness + session count |
| `POST /mcp` | MCP messages; a request without a session ID must be `initialize` |
| `GET /mcp` | server → client SSE stream for an open session |
| `DELETE /mcp` | terminates a session |

Each Streamable HTTP session gets its own `McpServer` instance, so state never
leaks between conversations.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `HOST` | `127.0.0.1` | bind address |
| `ALLOWED_HOSTS` | — | extra `Host` values for the DNS-rebinding guard; add the tunnel hostname here in stage 1 |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DEMO_MODE` | `false` | forces fallback drafts once generation exists (stage 5+) |

Logs are JSON lines on stderr. Every HTTP request carries a `requestId` (also
returned as the `x-request-id` header) and every tool call logs its name,
MCP session and duration via `withToolLogging`.

## Layout

```text
src/
├── index.ts       entry point, signal handling, graceful shutdown
├── server.ts      express app, /health and the /mcp endpoints
├── config.ts      environment configuration
├── logger.ts      structured logging
├── mcp/           MCP server factory, tools, resources
├── data/          fixtures loading          (stage 3)
├── store/         in-memory session store   (stage 3)
├── generation/    generation brief builder  (stage 5)
└── types/         shared domain types
scripts/smoke.mjs  stage 0 acceptance check
fixtures/          JSON fixture data         (stage 3)
ui/                MCP Apps widget source    (stage 4)
```

## Current state — stage 0

Scaffold only. The one registered tool is `ping`, a connectivity probe with no
Steward logic: the SDK advertises the tools capability lazily, so a server with
zero tools cannot answer `tools/list` and is not discoverable by a test client.

`open_steward` and the `ui://steward/app.html` resource land in stage 1; the
generation tools in stage 2.

### Checking it by hand

```bash
npm run build
npm run smoke
```

Or point MCP Inspector at `http://127.0.0.1:3000/mcp` (Streamable HTTP) while
`npm run dev` is running.
