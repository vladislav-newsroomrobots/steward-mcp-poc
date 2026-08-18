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
| `GET /stats` | briefs handed to the model, by orchestration variant; `?format=text` for a report |
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
Steward must produce both a `"tool":"open_steward"` and a `"tool":"get_workspace"`
line. The second one is the widget loading its pickers, which proves the call
travelled from the iframe through the host into the server.

### After a tunnel restart

Cloudflare issues a **new hostname** every time, so the URL saved in ChatGPT
stops working — update it in the app settings. `ALLOWED_HOSTS=*` means the server
itself needs no change.

## Tools and resources

| Name | Visible to | Purpose |
|---|---|---|
| `open_steward` | model, app | entry point; renders `ui://steward/app.html` in the conversation |
| `get_workspace` | model, app | document types and funders; resolves a name the user said into an id |
| `get_linked_objects` | model, app | the opportunities linked to a funder |
| `request_generation` | model, app | returns the generation brief the model writes from |
| `create_session` | app | opens a drafting session |
| `get_session` | app | session state for the panel |
| `ping` | model, app | connectivity probe, no Steward logic |
| `ui://steward/app.html` | — | resource: the single-file MCP Apps widget |

Visibility comes from `_meta.ui.visibility`. Session plumbing is hidden from the
model so it cannot wander into it. No tool accepts a finished draft: the model
writes it in the conversation and shows it there.

## Workspace data

Fixtures are checked in as JSON under `fixtures/` and loaded once at startup.
`test-data/` holds the CSV exports they were derived from, kept for reference.

Shapes mirror the production contracts in the extension's `api-client.ts`
(`UserDetailsResponse`, `LinkedOpportunity`) rather than the simplified ones in
the stage plan, so phase 2 swaps the loader for real endpoints and leaves the
tools and widget untouched.

| File | Contents |
|---|---|
| `funders.json` | 11 funders with their full CRM payload under `raw` |
| `deals.json` | 18 opportunities, joined to funders by `funderId` |
| `document-types.json` | 4 types with `tips` and `systemInstructions` |
| `drafts.json` | pre-written drafts for demo mode, `*` matches anything |

Editing them is a matter of editing the JSON. The one invariant to keep is that
every `deal.funderId` matches a funder `id` — nothing enforces it at build time.

`systemInstructions` never reach the model through `get_workspace` — they are
prompt material the server injects into the brief, not something to paraphrase.

The `raw` payload carries every column of the export, most of it plumbing.
`buildGenerationBrief` projects a curated subset into the brief: giving history,
contact, funder type, notes, and the opportunity's stage, amounts and next step.
Passing `raw` wholesale would bury the few facts that change the prose.

## The generation cycle

The server never calls an LLM, and it never receives a draft either. It hands
the host model a brief; the document is written and shown in the conversation:

```text
Generate (widget)
   → request_generation   returns the brief
   → the model writes the document
   → the model says the draft is ready and asks whether to show it
   → the user says yes; the model prints it in the chat
```

The pause before printing is deliberate. The model writes the whole document
first and holds it, so the user gets one short sentence rather than several
hundred words they did not ask to see yet. `request_generation` says so in its
`nextStep`, the tool description repeats it, and so do the server instructions —
a model that stops after the brief, or dumps the document unasked, is the
failure mode worth over-instructing against.

Nothing lands in the store. `get_session` reports the inputs the brief went out
with and the session sits at `briefed`; a version exists only if a panel-side
edit created one (stage 5). Refinement therefore depends on the model passing
the text back: `request_generation` takes an optional `existingDraft`, and
without it the brief is written from scratch.

Two orchestration variants exist. The panel drives B; A is still accepted by
`request_generation` and exercised by the smoke check, but nothing in the widget
selects it any more:

| Variant | How it starts | Trade-off |
|---|---|---|
| A — UI tool call | a caller passes `variant: "ui-tool-call"` to `request_generation` | fewest moving parts, but the model must notice the tool result and continue unprompted |
| B — conversation | the widget sends a follow-up message via `ui/message` | the model drives the whole cycle, which is the path hosts are tuned for |

### Measuring reliability

`GET /stats` returns JSON; `GET /stats?format=text` prints a report:

```text
Stage 2 — generation orchestration

overall           20 briefs    4 refinements
variant A (ui)    10 briefs    2 refinements
variant B (chat)  10 briefs    2 refinements
```

Briefs only, and that is the honest limit of it: the draft never returns to the
server, so nothing here can say whether the model finished, held the document
back, or printed it unasked. That is judged by reading the chat — these counters
exist to attribute those readings to a variant. They live in memory and reset
with the process, so finish a matrix in one run.

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

## Current state — stage 3

The `request_generation → model writes → model offers the draft in chat` cycle
works on fixture data, with refinement and both orchestration variants. Briefs
carry the document type's own instructions plus real funder and opportunity
context, so draft quality reflects what the product would actually produce.

The widget has document type, funder and opportunity pickers and surfaces the
writing tips, but it is context only — it never shows a draft — and it is still
a spike harness rather than the real interface. That is stage 4. Manual editing,
version history, feedback and copy tracking are stage 5; the session store
already implements them and they are covered by the smoke check ahead of the
tools that expose them.

`npm run smoke` exercises everything the server can be held to: the brief, the
`briefed` session state, the refinement hand-back, and the instruction the model
receives. What no server-side check can reach is the half that now happens in
the conversation — whether the model writes the document, offers it, and waits.
That is what the matrix below is for, and it is read by eye.

### Running the reliability matrix

Restart the server first so the counters start clean, then, from ChatGPT, run
the documented spread through the panel (variant B). For each run, note by hand
whether the model wrote the document, offered it in one short sentence, and
waited for the user before printing it:

| Case | Runs |
|---|---:|
| thank-you letters | 5 |
| grant reports | 5 |
| vague requests | 5 |
| refinements | 5 |

Read the brief counts with:

```bash
curl "http://localhost:3000/stats?format=text"
```

They tell you how many briefs each variant produced, not how many cycles
finished — that number comes from your own tally of the chats.

### Checking it by hand

```bash
npm run build
npm run smoke
```

Or point MCP Inspector at `http://127.0.0.1:3000/mcp` (Streamable HTTP) while
`npm run dev` is running.
