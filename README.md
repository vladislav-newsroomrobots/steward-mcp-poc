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
| `npm run dev` | builds the widget, then starts the server with reload on change |
| `npm run build` | builds the widget and compiles TypeScript to `dist/` |
| `npm run build:ui` | rebuilds only the widget (the server re-reads it per request) |
| `npm run start` | runs the compiled server |
| `npm run typecheck` | type checks the server and the widget |
| `npm run smoke` | acceptance check for the current stage (run `npm run build` first) |
| `npm run tunnel` | opens a Cloudflare Quick Tunnel to the local server |

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
| `ALLOWED_HOSTS` | — | extra `Host` values for the DNS-rebinding guard, comma separated; `*` disables the check (see below) |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DEMO_MODE` | `false` | forces fallback drafts once generation exists (stage 5+) |

Logs are JSON lines on stderr. Every HTTP request carries a `requestId` (also
returned as the `x-request-id` header) and every tool call logs its name,
MCP session and duration via `withToolLogging`.

### The host header guard

The MCP SDK rejects requests whose `Host` header is not localhost, which is what
protects a local server from DNS rebinding. Put a tunnel in front and every
request arrives with the tunnel's hostname instead, so it answers:

```json
{"error":{"message":"Invalid Host: <hostname>"}}
```

Named tunnels: list the hostname in `ALLOWED_HOSTS`. Ephemeral ones such as
`trycloudflare.com` mint a new hostname on every restart, so an allowlist is
unmaintainable — set `ALLOWED_HOSTS=*` instead. That drops the protection: any
page open in your browser can then reach the server on localhost, which is fine
for local development with fixture data and not for anything else. The server
logs a warning at startup whenever it runs that way.

Configuration is read once at startup, so restart the server after changing
`.env` — `tsx watch` follows `src/`, not the environment.

## Connecting to ChatGPT

ChatGPT cannot reach `localhost`, so development goes through a Cloudflare Quick
Tunnel:

```text
ChatGPT Web
    ↓
https://<random-name>.trycloudflare.com/mcp
    ↓
Cloudflare Tunnel
    ↓
http://localhost:3000/mcp
    ↓
Steward MCP server
```

`cloudflared` connects outbound, so no inbound port is opened and the server
keeps listening on `127.0.0.1` only. The tunnel URL itself, however, **is public
and unauthenticated** — anyone who learns it can call the tools while the tunnel
is up. Fine for fixture data; stop `cloudflared` when you are done.

### 1. Install cloudflared

```bash
brew install cloudflared                          # macOS
winget install --id Cloudflare.cloudflared        # Windows
sudo apt update && sudo apt install cloudflared   # Debian/Ubuntu
```

If your distribution has no package, use Cloudflare's official installer for it.
Verify with `cloudflared --version`.

### 2. Start the MCP server

Terminal 1:

```bash
npm run dev
```

Check it before going further. A plain `GET /mcp` returns 404 and proves
nothing — the endpoint expects a POST that opens a session:

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

### 3. Open the tunnel

Terminal 2, and leave it running for as long as you test:

```bash
npm run tunnel
```

Wait for `Registered tunnel connection` and the assigned hostname:

```text
Your quick Tunnel has been created!
https://random-name.trycloudflare.com
```

Your MCP URL is that hostname plus `/mcp`.

### 4. Allow the tunnel hostname

Quick Tunnels mint a new hostname on every restart, so `.env` must carry:

```text
ALLOWED_HOSTS=*
```

Restart the server after changing it — configuration is read once at startup.
Without this the server answers `403 Invalid Host: <hostname>`; see
[the host header guard](#the-host-header-guard) for what that trade-off costs.

### 5. Verify through the tunnel

```bash
curl https://random-name.trycloudflare.com/health      # curl.exe on Windows
```

Expect `{"status":"ok",...}`. On `/mcp` a plain GET may return 400/404/405 or an
MCP session error — all fine. What is *not* fine is a Cloudflare `530` or `1033`:
that means the tunnel never reached your server.

### 6. Connect in ChatGPT

Settings → Apps → Developer mode → Create, then paste:

```text
https://random-name.trycloudflare.com/mcp
```

Run **Scan Tools**; `ping` and `open_steward` should both appear. Then, in a chat
with the connector enabled:

```text
Use the open_steward tool
Call open_steward with funderId "acme"
```

The strongest confirmation is the server log rather than the panel: opening
Steward and clicking **Ping server** must produce both a `"tool":"open_steward"`
and a `"tool":"ping"` line. The second one proves the call travelled from the
iframe through the host into the server.

### After a tunnel restart

Cloudflare issues a **new hostname** every time, so the URL saved in ChatGPT
stops working — update it in the app settings. `ALLOWED_HOSTS=*` means the server
itself needs no change.

## Tools and resources

| Name | Kind | Purpose |
|---|---|---|
| `open_steward` | tool | entry point; renders `ui://steward/app.html` in the conversation |
| `ping` | tool | connectivity probe, no Steward logic |
| `ui://steward/app.html` | resource | the single-file MCP Apps widget |

## Layout

```text
src/
├── index.ts       entry point, signal handling, graceful shutdown
├── server.ts      express app, /health and the /mcp endpoints
├── config.ts      environment configuration
├── logger.ts      structured logging
├── paths.ts       package-root-relative paths
├── mcp/           MCP server factory, tools, resources
├── data/          fixtures loading          (stage 3)
├── store/         in-memory session store   (stage 3)
├── generation/    generation brief builder  (stage 5)
└── types/         shared domain types
ui/
├── index.html     widget shell and styles
├── src/main.ts    widget logic
└── dist/app.html  build output, served as the MCP Apps resource (git-ignored)
scripts/
├── build-ui.mjs   esbuild bundle → single self-contained HTML
└── smoke.mjs      acceptance check
fixtures/          JSON fixture data         (stage 3)
```

## The widget

The host renders the widget in a sandboxed iframe under a strict CSP, so
everything is inlined into one HTML file — no external scripts, styles or
fonts. `scripts/build-ui.mjs` bundles `ui/src/main.ts` with esbuild and injects
it into `ui/index.html`.

Inside the iframe, `@modelcontextprotocol/ext-apps` connects to the host over
`postMessage` and calls MCP tools through it. The server is never contacted
directly by the iframe.

Stage 4 may swap esbuild for Vite + React; the output contract — a single
`ui/dist/app.html` — stays the same.

## Current state — stage 1

`open_steward` renders the widget, which connects to the host, shows host name,
theme and locale, and calls `ping` through the host on demand. There is no
Steward data or generation yet: fixtures arrive in stage 3, the generation tools
in stage 2.

Verifying the iframe itself requires a real host — the smoke check can only
confirm the resource is served, self-contained and correctly typed.

### Checking it by hand

```bash
npm run build
npm run smoke
```

Or point MCP Inspector at `http://127.0.0.1:3000/mcp` (Streamable HTTP) while
`npm run dev` is running.
