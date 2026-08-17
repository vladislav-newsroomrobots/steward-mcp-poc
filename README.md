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
| `npm run dev:ui` | Vite dev server for the widget — see [the widget](#the-widget) for what it can and cannot show |
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
| `DEMO_MODE` | `false` | reserved for the fallback drafts in `fixtures/drafts.json`; nothing reads it yet |

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
| `get_workspace` | model, app | document types, funders and the feedback tags; resolves a name the user said into an id |
| `get_linked_objects` | model, app | the opportunities linked to a funder |
| `request_generation` | model, app | returns the generation brief the model writes from |
| `render_draft` | model | stores the document the model wrote and shows it in the panel |
| `save_edit` | model, app | stores wording the user supplied as a new version, attributed to them |
| `submit_feedback` | model, app | records a rating with one required tag |
| `track_copy` | app | counts a draft leaving the panel for the clipboard |
| `create_session` | app | opens a drafting session |
| `get_session` | app | session state and every version, polled by the widget while generating |
| `ping` | model, app | connectivity probe, no Steward logic |
| `ui://steward/app.html` | — | resource: the single-file MCP Apps widget |

Visibility comes from `_meta.ui.visibility`. Session plumbing is hidden from the
model so it cannot wander into it, and `render_draft` is hidden from the widget
because only the model produces drafts. `save_edit` and `submit_feedback` answer
to both: the user can hand over their own wording, or rate a draft, in the chat
as readily as in the panel.

A rejected call carries its code in the message — `[FEEDBACK_ALREADY_GIVEN] …` —
so the panel can tell a modelled outcome from a real failure, and the model can
tell what not to retry.

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

## The draft format

Drafts are rich text, not plain text — the viewer renders paragraphs, lists and
pull quotes, and a copy has to survive a paste into Gmail. The canonical format
is a small subset of HTML:

```text
p · h2 · h3 · ul / ol / li · blockquote · strong · em · u · s · a[href] · br
```

No other tags, no attributes beyond `href` and a `text-align` / `margin-left`
style, no classes. `render_draft` and `save_edit` sanitize into that subset rather
than trusting their caller: a model can be asked to stay inside it, and
`contenteditable` cannot. Plain text is accepted and wrapped in paragraphs, so a
model that ignores the format still produces a readable draft.

Two implementations, one allowlist: `src/generation/canonical-html.ts` for
anything arriving over MCP, and `ui/src/canonical.ts` for the editor, which has a
real DOM to work with.

`render_draft` also accepts the parameter under its old name, `text`. That is not
politeness: a host caches the tool list from its last scan, and a call whose
arguments do not match the current schema is rejected **inside the SDK**, before
the handler and before any logging. The server sees nothing at all, the attempt
times out, and it looks exactly like a model that never answered — which is a
day's debugging for a renamed field. The alias absorbs it and logs
`render_draft called with the legacy text parameter`, naming the fix: re-scan the
connector.

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

### When a generation stalls

The model stopping after the brief is the one failure the panel cannot observe,
and during a spike it is a normal Tuesday rather than an exception. A deadline
that only produced a red status would leave the finished letter sitting in the
model's context with no way to get it out, so the panel offers three ways on:

| | |
|---|---|
| **Check again** | one read of `get_session`. A late `render_draft` is accepted — it stores the version and revives the failed session — so this picks up a draft that arrived after the deadline |
| **Ask the model again** | re-runs the same request against the same session |
| **Copy session id** | the part that cannot be improvised: paste it into the chat and ask the model to call `render_draft` with the document it already wrote. In variant B the id otherwise appears only in the widget's own message |

The attempt still counts as a timeout in `/stats` even when a late draft lands.
That is deliberate: the metric measures whether the cycle completes on its own.

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
├── data/          fixture loading, feedback tags
├── store/         in-memory session store, versions and events
├── generation/    brief builder and the canonical draft format
└── types/         shared domain types
ui/
├── index.html     Vite entry — a mount point, nothing else
├── vite.config.ts single-file build configuration
└── src/
    ├── main.tsx      bootstrap and the fatal-error banner
    ├── App.tsx       all panel state and every tool call
    ├── host.ts       the MCP Apps client, and error codes recovered from it
    ├── canonical.ts  sanitizer for the editor
    ├── clipboard.ts  rich + plain clipboard write
    ├── suggest.ts    context ranking for a request that names nobody
    ├── styles.css    extension design tokens
    └── components/   picker, suggestions, draft viewer, toolbar, feedback,
                      failure recovery
dist/app.html      build output, served as the MCP Apps resource (git-ignored)
scripts/
├── build-ui.mjs   Vite build → single self-contained HTML, plus its guard rails
└── smoke.mjs      acceptance check
fixtures/          JSON fixture data
```

## The widget

Vite + React, bundled into one self-contained `ui/dist/app.html`. The host renders
it in a sandboxed iframe under a strict CSP, so nothing may come from an external
origin — script, stylesheet and any asset are inlined, and `scripts/build-ui.mjs`
fails the build if a single `src`/`href` to anything but a `data:` URI survives.

Inside the iframe, `@modelcontextprotocol/ext-apps` connects to the host over
`postMessage` and calls MCP tools through it. The server is never contacted
directly by the iframe.

`npm run dev:ui` serves the widget with hot reload, which is useful for layout
work and nothing else: there is no host on the other side of `postMessage`, so the
panel shows its connection error and no workspace. Anything involving data or
generation is exercised through `npm run dev` and a real conversation.

### What the panel does

The design, the scenarios and the tokens come from `artifact/ui-prototype.html`,
the product walkthrough. Its live panels are implemented here:

| Walkthrough | In the panel |
|---|---|
| B1 workspace picker | document type, funder and opportunity as pills, with search |
| B2 resume a session | the summary cards above the draft |
| C0 zero-context request | ranked suggestions with the reasons they scored on |
| C1 draft viewer | versions ‹ ›, the formatting toolbar, copy, 👍/👎 |
| C5–C7 refinement | **Ask for changes** reopens the picker; the current draft goes into the brief |
| E1 manual edit | **Edit** → **Save**, stored as the user's own version |
| E2–E3 tagged feedback | one tag required, the extension's eight |
| E5 Gmail-ready copy | `text/html` + `text/plain`, then `track_copy` |
| F1–F2 switch type, switch topic | change the picker mid-session, or start a new document |
| H1 duplicate feedback | the server rejects it and the panel says so |
| — a stalled generation | **Check again**, **Ask the model again**, **Copy session id** — see [when a generation stalls](#when-a-generation-stalls) |

Three departures from the prototype, all deliberate:

- **Fonts.** DM Sans and Inter are named but not loaded — the CSP forbids the
  external origin, so readers who have them get them and everyone else gets the
  system stack.
- **One funder, one opportunity per draft.** The prototype multi-selects; the
  tools take a single `funderId`/`dealId`, matching the brief the model writes
  from. Multi-object context (C3, C4) needs the brief to change too.
- **Opportunities load per funder**, not as a flat list — that is the backend
  contract (`GET /platform/funders/:id/deals`) and what the extension does.

Sign-in (block A) and Google Drive context documents (block D) are not here at
all: neither has fixtures, tools or a backend in this PoC. They are phase 2.

## Current state — stage 4

The Steward interface is a React app in the extension's own visual language,
running the full loop end to end on fixture data: pick context or accept the
suggestions, generate, read the draft, edit it, rate it, copy it, ask for another
version. Every one of those actions is a real tool call against the server; the
session store keeps the version trail and the events behind them.

Still open from the stage plan: multi-object context, the model-facing
`suggest_context` tool (the ranking lives in the widget for now), demo-mode
fallback drafts, and the formal error model of stage 6.

`npm run smoke` exercises the whole server side, standing in for the model —
including the canonical-format sanitizing and the edit/feedback/copy lifecycle.
What it cannot check is whether a real host completes the cycle, or whether the
panel renders as intended inside it: that needs ChatGPT and the matrix below.

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
