/**
 * Acceptance check for the current stage.
 *
 * Starts the built server on its own port and exercises /health, the Streamable
 * HTTP MCP handshake, the registered tools and MCP Apps resource, the session
 * error paths, and graceful shutdown.
 *
 *   npm run build && npm run smoke
 */
process.env.PORT ??= '3123';
process.env.HOST ??= '127.0.0.1';
process.env.LOG_LEVEL ??= 'warn';

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startServer } = await import('../dist/server.js');

const baseUrl = `http://${process.env.HOST}:${process.env.PORT}`;
const mcpUrl = new URL(`${baseUrl}/mcp`);

let failures = 0;

function check(name, condition, detail) {
    if (condition) {
        console.log(`  PASS  ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
    }
}

const server = await startServer();
const client = new Client({ name: 'steward-smoke', version: '0.0.0' });

try {
    console.log('\n/health');
    const health = await fetch(`${baseUrl}/health`);
    const healthBody = await health.json();
    check('responds 200', health.status === 200, health.status);
    check('reports status ok', healthBody.status === 'ok', healthBody);

    console.log('\nMCP handshake');
    await client.connect(new StreamableHTTPClientTransport(mcpUrl));
    const serverInfo = client.getServerVersion();
    check('initialize succeeds', serverInfo?.name === 'steward-mcp', serverInfo);
    check('session id issued', typeof client.transport?.sessionId === 'string', client.transport?.sessionId);

    const { tools } = await client.listTools();
    check('tools/list is discoverable', Array.isArray(tools), tools);
    check('ping is advertised', tools.some(tool => tool.name === 'ping'), tools.map(tool => tool.name));

    check('open_steward is advertised', tools.some(tool => tool.name === 'open_steward'), tools.map(tool => tool.name));

    const openSteward = tools.find(tool => tool.name === 'open_steward');
    const uiMeta = openSteward?._meta?.ui;
    check('open_steward points at the UI resource', uiMeta?.resourceUri === 'ui://steward/app.html', openSteward?._meta);

    const pong = await client.callTool({ name: 'ping', arguments: {} });
    check('ping returns pong', pong.structuredContent?.message === 'pong', pong.structuredContent);

    const opened = await client.callTool({ name: 'open_steward', arguments: { funderId: 'acme' } });
    check('open_steward echoes funderId', opened.structuredContent?.funderId === 'acme', opened.structuredContent);

    console.log('\nMCP Apps resource');
    const { resources } = await client.listResources();
    check(
        'app resource is listed',
        resources.some(resource => resource.uri === 'ui://steward/app.html'),
        resources.map(resource => resource.uri),
    );

    const widget = await client.readResource({ uri: 'ui://steward/app.html' });
    const doc = widget.contents[0];
    check('resource uses the MCP Apps mime type', doc?.mimeType === 'text/html;profile=mcp-app', doc?.mimeType);
    check('widget html is self-contained', typeof doc?.text === 'string' && doc.text.includes('<script type="module">'));
    check('widget has no external src', typeof doc?.text === 'string' && !/<script[^>]+src=/.test(doc.text));
    // `$&` and "$`" in the bundle are substitution patterns for String.replace.
    // Injecting the script with a string replacement silently splices the
    // surrounding HTML into the JavaScript and breaks the whole widget.
    check('script injection did not corrupt the bundle', !doc?.text?.includes('APP_SCRIPT'));
    check(
        'stylesheet appears exactly once',
        (doc?.text?.split('color-scheme: light dark').length ?? 0) - 1 === 1,
        (doc?.text?.split('color-scheme: light dark').length ?? 0) - 1,
    );

    console.log('\nTool visibility');
    const visibility = Object.fromEntries(tools.map(tool => [tool.name, tool._meta?.ui?.visibility]));
    check('render_draft is gone', !tools.some(tool => tool.name === 'render_draft'), tools.map(tool => tool.name));
    check('get_session is app-only', JSON.stringify(visibility.get_session) === '["app"]', visibility.get_session);
    check('create_session is app-only', JSON.stringify(visibility.create_session) === '["app"]', visibility.create_session);

    console.log('\nWorkspace fixtures');
    const ws = (await client.callTool({ name: 'get_workspace', arguments: {} })).structuredContent;
    check('document types load', ws?.documentTypes?.length >= 3, ws?.documentTypes?.length);
    check('funders load', ws?.funders?.length >= 5, ws?.funders?.length);
    check('document types carry tips', ws?.documentTypes?.every(t => t.tips?.length > 0));
    // systemInstructions are prompt material the server injects, not something
    // the model should read back or paraphrase.
    check('systemInstructions are not exposed', ws?.documentTypes?.every(t => t.systemInstructions === undefined));

    const funderId = ws.funders[0].id;
    const documentTypeId = ws.documentTypes[0].id;

    const linked = (await client.callTool({ name: 'get_linked_objects', arguments: { funderId } }))
        .structuredContent;
    check('funder has opportunities', linked?.opportunities?.length > 0, linked?.opportunities?.length);
    check('opportunities carry a stage', linked.opportunities.every(o => typeof o.stage === 'string'));

    const badFunder = await client.callTool({ name: 'get_linked_objects', arguments: { funderId: 'nope' } });
    check('unknown funder is an MCP error', badFunder.isError === true);

    // Fixtures are hand-maintained JSON, so nothing but this stops a deal from
    // pointing at a funder that no longer exists.
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const allFunders = req('../fixtures/funders.json');
    const allDeals = req('../fixtures/deals.json');
    const dangling = allDeals.filter(d => !allFunders.some(f => f.id === d.funderId));
    check('every deal resolves to a funder', dangling.length === 0, dangling.map(d => d.title));
    check('every funder has at least one deal', allFunders.every(f => allDeals.some(d => d.funderId === f.id)));

    console.log('\nGeneration cycle');
    const inputs = {
        documentTypeId,
        funderId,
        dealId: linked.opportunities[0].id,
        userRequest: 'Mention the county-government desk.',
        wordLimit: 300,
    };

    const session = await client.callTool({ name: 'create_session', arguments: inputs });
    const generationSessionId = session.structuredContent?.sessionId;
    check('create_session returns an id', typeof generationSessionId === 'string', session.structuredContent);

    const brief = await client.callTool({
        name: 'request_generation',
        arguments: { sessionId: generationSessionId, ...inputs, variant: 'ui-tool-call' },
    });
    const generationBrief = brief.structuredContent?.generationBrief;
    check('request_generation returns a brief', generationBrief?.funder === ws.funders[0].name, generationBrief?.funder);
    check('brief carries the word limit', generationBrief?.constraints?.wordLimit === 300, generationBrief?.constraints);
    check('first brief has no existing draft', generationBrief?.existingDraft === undefined);
    check(
        'brief uses the document type systemInstructions',
        typeof generationBrief?.instructions === 'string' && generationBrief.instructions.length > 200,
        generationBrief?.instructions?.length,
    );
    check('brief carries funder context', generationBrief?.context?.funder?.funderType !== undefined, generationBrief?.context?.funder);
    check('brief carries opportunity context', generationBrief?.context?.opportunity?.stage !== undefined, generationBrief?.context?.opportunity);
    // The CRM export is mostly plumbing; only fields a fundraiser would use
    // belong in the brief.
    check('brief omits CRM plumbing', generationBrief?.context?.funder?.sourceSystem === undefined);
    const nextStep = brief.structuredContent?.nextStep;
    check('result tells the model to continue', typeof nextStep === 'string' && nextStep.includes('Do not stop here'));
    // The draft is the model's to show. The instruction has to say so, and it
    // must not point anywhere else: there is no tool left to take the text.
    check(
        'result keeps the draft in the chat',
        typeof nextStep === 'string' && nextStep.includes('ask whether') && nextStep.includes('once they say yes'),
        nextStep,
    );
    check('result names no draft tool', typeof nextStep === 'string' && !nextStep.includes('render_draft'));

    const briefed = await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } });
    check('session is briefed', briefed.structuredContent?.status === 'briefed', briefed.structuredContent);
    check('no draft is stored', briefed.structuredContent?.latestDraft === null, briefed.structuredContent?.latestDraft);

    console.log('\nRefinement');
    // The server keeps no draft, so a refinement brief is only as good as the
    // text the model hands back.
    const draftText = 'Dear Acme Foundation, thank you for supporting our education programme.';
    const refine = await client.callTool({
        name: 'request_generation',
        arguments: { sessionId: generationSessionId, userRequest: 'Make it warmer.', existingDraft: draftText },
    });
    check(
        'refinement brief includes the draft the model passed back',
        refine.structuredContent?.generationBrief?.existingDraft === draftText,
        refine.structuredContent?.generationBrief?.existingDraft,
    );
    check(
        'omitted fields fall back to the session',
        refine.structuredContent?.generationBrief?.funder === ws.funders[0].name,
    );

    console.log('\nGeneration errors');
    const unknownSessionCall = await client.callTool({
        name: 'request_generation',
        arguments: { sessionId: 'does-not-exist' },
    });
    check('unknown session is an MCP error', unknownSessionCall.isError === true, unknownSessionCall.isError);

    // Exercised directly: the tools that expose these land in stage 5, and
    // shipping the store untested until then invites a nasty surprise.
    console.log('\nSession store events');
    const { sessionStore } = await import('../dist/store/session-store.js');
    const s = sessionStore.create({});
    sessionStore.addVersion(s.id, 'First draft text.', 'gpt');
    const v1 = s.versions.at(-1);

    sessionStore.saveEdit(s.id, '  First   draft text.  ');
    check('whitespace-only edit creates no version', s.versions.length === 1, s.versions.length);

    sessionStore.saveEdit(s.id, 'First draft text, edited.');
    check('a real edit creates a version', s.versions.length === 2, s.versions.length);
    check('edited version is attributed to the user', s.versions.at(-1).source === 'user');

    sessionStore.addFeedback(s.id, v1.id, 'like');
    sessionStore.addCopyEvent(s.id, v1.id);
    check('events are recorded', s.events.length === 2, s.events.length);
    check('feedback carries its type', s.events[0].feedback === 'like', s.events[0]);

    let rejected = false;
    try {
        sessionStore.addFeedback(s.id, 'not-a-version', 'like');
    } catch {
        rejected = true;
    }
    check('feedback on an unknown version is rejected', rejected);

    console.log('\nFallback drafts');
    const { workspace } = await import('../dist/data/workspace.js');
    const exact = workspace.fallbackDraft('dt-thank-you-letter', 'recfbSXdGVStsacWl');
    check('exact fallback matches', exact?.documentTypeId === 'dt-thank-you-letter', exact?.documentTypeId);
    const generic = workspace.fallbackDraft('dt-grant-report', 'no-such-funder');
    check('falls back to the generic draft', generic?.documentTypeId === '*', generic?.documentTypeId);
    check('fallback drafts have real text', (generic?.text?.length ?? 0) > 400, generic?.text?.length);

    console.log('\nSpike metrics');
    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    check('two briefs recorded', stats.overall.briefs === 2, stats.overall);
    check('one refinement recorded', stats.overall.refinements === 1, stats.overall);
    check('variant is attributed', stats.byVariant['ui-tool-call'].briefs === 1, stats.byVariant);
    check('refinement is flagged', stats.runs.some(run => run.isRefinement === true));

    const statsText = await (await fetch(`${baseUrl}/stats?format=text`)).text();
    check('text report renders', statsText.includes('Stage 2 — generation orchestration'));

    console.log('\nSession error paths');
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    const unknownSession = await fetch(mcpUrl, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': 'not-a-real-session' },
        body: rpc,
    });
    check('unknown session id → 404', unknownSession.status === 404, unknownSession.status);

    const noSession = await fetch(mcpUrl, { method: 'POST', headers, body: rpc });
    check('missing session id → 400', noSession.status === 400, noSession.status);

    console.log('\nGraceful shutdown');
    await client.close();
    await server.close();

    let refused = false;
    try {
        await fetch(`${baseUrl}/health`);
    } catch {
        refused = true;
    }
    check('port released after close()', refused);
} catch (error) {
    failures += 1;
    console.error('\nUnexpected error:', error);
    await client.close().catch(() => {});
    await server.close().catch(() => {});
}

console.log(failures === 0 ? '\nSmoke: OK\n' : `\nSmoke: ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
