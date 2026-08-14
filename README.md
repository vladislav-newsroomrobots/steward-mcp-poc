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
| `GET /stats` | generation reliability metrics; `?format=text` for a report |
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
| `GENERATION_TIMEOUT_MS` | `120000` | how long a generation may stay open before it counts as failed |
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

| Name | Visible to | Purpose |
|---|---|---|
| `open_steward` | model, app | entry point; renders `ui://steward/app.html` in the conversation |
| `request_generation` | model, app | returns the generation brief the model writes from |
| `render_draft` | model | stores the document the model wrote and shows it in the panel |
| `create_session` | app | opens a drafting session |
| `get_session` | app | session state, polled by the widget while generating |
| `ping` | model, app | connectivity probe, no Steward logic |
| `ui://steward/app.html` | — | resource: the single-file MCP Apps widget |

Visibility comes from `_meta.ui.visibility`. Session plumbing is hidden from the
model so it cannot wander into it, and `render_draft` is hidden from the widget
because only the model produces drafts.

## The generation cycle

The server never calls an LLM. It hands the host model a brief and takes back a
finished document:

```text
Generate (widget)
   → request_generation   returns the brief
   → the model writes the document
   → render_draft         stores it, panel updates
```

`render_draft` is a separate call from the model to the server, so the widget is
never told directly that a draft landed — it polls `get_session` while the
status is `generating`.

Two orchestration variants are implemented, switchable in the widget:

| Variant | How it starts | Trade-off |
|---|---|---|
| A — UI tool call | the widget calls `request_generation` itself | fewest moving parts, but the model must notice the tool result and continue unprompted |
| B — conversation | the widget sends a follow-up message via `ui/message` | the model drives the whole cycle, which is the path hosts are tuned for |

A generation that never reaches `render_draft` is failed after
`GENERATION_TIMEOUT_MS`. That deadline is evaluated when the session is read
rather than by a timer, so nothing leaks and nothing can sit in `generating`
forever.

### Measuring reliability

Every attempt is recorded. `GET /stats` returns JSON;
`GET /stats?format=text` prints a report:

```text
Stage 2 — generation orchestration

overall           20 attempts   19 rendered    1 timed out    0 pending    95.0%  12.4s avg
variant A (ui)    10 attempts    8 rendered    2 timed out    0 pending    80.0%  11.8s avg
variant B (chat)  10 attempts   10 rendered    0 timed out    0 pending   100.0%  13.0s avg
```

The stage 2 target is ≥90% during the spike and ≥95% after tuning. Counters live
in memory and reset with the process, so finish a matrix in one run.

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

## Current state — stage 2

The full `request_generation → model writes → render_draft` cycle works, with
refinement, both orchestration variants and reliability metrics. Data is still
free text typed into the widget; fixtures, document-type tips and funder/deal
pickers arrive in stage 3, and the real interface in stage 4.

The widget is a spike harness on purpose — plain fields and a variant switch,
enough to run the matrix and watch the cycle complete.

`npm run smoke` exercises the whole cycle server-side, standing in for the model.
What it cannot check is whether a real host actually completes the cycle — that
is what the matrix below is for.

### Running the reliability matrix

Restart the server first so the counters start clean, then, from ChatGPT, run
the documented spread per variant:

| Case | Runs |
|---|---:|
| thank-you letters | 5 |
| grant reports | 5 |
| vague requests | 5 |
| refinements | 5 |

Read the result with:

```bash
curl "http://localhost:3000/stats?format=text"
```

### Checking it by hand

```bash
npm run build
npm run smoke
```

Or point MCP Inspector at `http://127.0.0.1:3000/mcp` (Streamable HTTP) while
`npm run dev` is running.
