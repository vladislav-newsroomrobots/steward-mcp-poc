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
    // The React app has one mount point; nothing renders without it.
    check('widget carries its mount point', doc?.text?.includes('id="root"'));
    // Every fetch the iframe cannot make: an asset Vite failed to inline renders
    // the panel blank in the host and perfectly in a browser.
    check(
        'no external references survive',
        [...(doc?.text?.matchAll(/\s(?:src|href)="([^"]*)"/g) ?? [])].every(
            ([, value]) => value.startsWith('data:') || value.startsWith('#'),
        ),
        [...(doc?.text?.matchAll(/\s(?:src|href)="([^"]*)"/g) ?? [])].map(([, value]) => value.slice(0, 40)),
    );
    check(
        'stylesheet is inlined exactly once',
        (doc?.text?.match(/<style/g)?.length ?? 0) === 1,
        doc?.text?.match(/<style/g)?.length,
    );

    console.log('\nTool visibility');
    const visibility = Object.fromEntries(tools.map(tool => [tool.name, tool._meta?.ui?.visibility]));
    check('render_draft is model-only', JSON.stringify(visibility.render_draft) === '["model"]', visibility.render_draft);
    check('get_session is app-only', JSON.stringify(visibility.get_session) === '["app"]', visibility.get_session);
    check('create_session is app-only', JSON.stringify(visibility.create_session) === '["app"]', visibility.create_session);
    check('track_copy is app-only', JSON.stringify(visibility.track_copy) === '["app"]', visibility.track_copy);
    // The user can hand over their own wording, or rate a draft, in chat as well
    // as in the panel — both tools answer to both callers.
    check(
        'save_edit is visible to both',
        JSON.stringify(visibility.save_edit) === '["model","app"]',
        visibility.save_edit,
    );
    check(
        'submit_feedback is visible to both',
        JSON.stringify(visibility.submit_feedback) === '["model","app"]',
        visibility.submit_feedback,
    );

    console.log('\nWorkspace fixtures');
    const ws = (await client.callTool({ name: 'get_workspace', arguments: {} })).structuredContent;
    check('document types load', ws?.documentTypes?.length >= 3, ws?.documentTypes?.length);
    check('funders load', ws?.funders?.length >= 5, ws?.funders?.length);
    check('document types carry tips', ws?.documentTypes?.every(t => t.tips?.length > 0));
    // The panel requires one tag per rating, so it has to be told the tags.
    check('feedback tags are served', ws?.feedbackTags?.like?.length === 4 && ws?.feedbackTags?.dislike?.length === 4, ws?.feedbackTags);
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
    check(
        'result tells the model to continue',
        typeof brief.structuredContent?.nextStep === 'string' && brief.structuredContent.nextStep.includes('render_draft'),
    );

    const generating = await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } });
    check('session is generating', generating.structuredContent?.status === 'generating', generating.structuredContent);

    check(
        'brief states the draft format',
        typeof generationBrief?.constraints?.format === 'string' &&
            generationBrief.constraints.format.includes('<blockquote>'),
        generationBrief?.constraints?.format,
    );

    // What a model actually sends: the canonical subset, plus the odd stray tag
    // and a script it should never have produced.
    const draftHtml =
        '<p>Dear <strong>Acme Foundation</strong>, thank you for supporting our education programme.</p>' +
        '<script>alert(1)</script><div class="signature" style="color:red">Riverside Chronicle</div>';
    const rendered = await client.callTool({
        name: 'render_draft',
        arguments: { sessionId: generationSessionId, html: draftHtml },
    });
    check('render_draft counts the words', rendered.structuredContent?.words === 12, rendered.structuredContent?.words);

    const ready = await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } });
    const storedDraft = ready.structuredContent?.latestDraft;
    check('session is ready', ready.structuredContent?.status === 'ready', ready.structuredContent?.status);
    check('one version exists', ready.structuredContent?.versionCount === 1, ready.structuredContent?.versionCount);
    check('draft keeps its canonical markup', storedDraft?.startsWith('<p>Dear <strong>Acme Foundation</strong>'), storedDraft);
    check('script content is dropped', !storedDraft?.includes('alert(1)'), storedDraft);
    check('unknown wrappers become paragraphs', storedDraft?.includes('<p>Riverside Chronicle</p>'), storedDraft);
    check('attributes are stripped', !/class=|style=/.test(storedDraft ?? ''), storedDraft);
    check(
        'versions are served to the panel',
        ready.structuredContent?.versions?.[0]?.html === storedDraft &&
            ready.structuredContent.versions[0].source === 'gpt' &&
            ready.structuredContent.versions[0].copyCount === 0,
        ready.structuredContent?.versions?.[0],
    );

    const emptyDraft = await client.callTool({
        name: 'render_draft',
        arguments: { sessionId: generationSessionId, html: '<div><span> </span></div>' },
    });
    check('a draft with no content is an MCP error', emptyDraft.isError === true, emptyDraft.isError);

    const noDocument = await client.callTool({
        name: 'render_draft',
        arguments: { sessionId: generationSessionId },
    });
    check('render_draft without a document is an MCP error', noDocument.isError === true, noDocument.isError);

    console.log('\nRefinement');
    const refine = await client.callTool({
        name: 'request_generation',
        arguments: { sessionId: generationSessionId, userRequest: 'Make it warmer.' },
    });
    check(
        'refinement brief includes the current draft',
        refine.structuredContent?.generationBrief?.existingDraft === storedDraft,
        refine.structuredContent?.generationBrief?.existingDraft,
    );
    check(
        'omitted fields fall back to the session',
        refine.structuredContent?.generationBrief?.funder === ws.funders[0].name,
    );

    await client.callTool({
        name: 'render_draft',
        arguments: { sessionId: generationSessionId, html: `${storedDraft}<p>We are grateful.</p>` },
    });
    const refined = await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } });
    check('two versions exist', refined.structuredContent?.versionCount === 2, refined.structuredContent?.versionCount);

    // A host that scanned the tool list before `text` was renamed to `html` would
    // otherwise fail schema validation inside the SDK — silently, from the
    // server's point of view, and indistinguishably from a model that never
    // answered at all. Checked on a session of its own so it cannot disturb the
    // version counts above.
    console.log('\nStale tool lists');
    const legacySessionId = (await client.callTool({ name: 'create_session', arguments: inputs }))
        .structuredContent?.sessionId;
    const legacyArgument = await client.callTool({
        name: 'render_draft',
        arguments: { sessionId: legacySessionId, text: 'Written by a caller with a stale tool list.' },
    });
    check('the legacy text parameter still works', legacyArgument.isError !== true, legacyArgument.content?.[0]?.text);

    const legacySession = (await client.callTool({ name: 'get_session', arguments: { sessionId: legacySessionId } }))
        .structuredContent;
    check(
        'a plain-text draft is wrapped in paragraphs',
        legacySession?.latestDraft === '<p>Written by a caller with a stale tool list.</p>',
        legacySession?.latestDraft,
    );

    console.log('\nDraft lifecycle');
    const secondVersionId = refined.structuredContent?.versions?.at(-1)?.id;

    const unchanged = await client.callTool({
        name: 'save_edit',
        arguments: { sessionId: generationSessionId, html: refined.structuredContent.latestDraft },
    });
    check('an edit that changes nothing creates no version', unchanged.structuredContent?.unchanged === true, unchanged.structuredContent);

    const edited = await client.callTool({
        name: 'save_edit',
        arguments: {
            sessionId: generationSessionId,
            html: '<p>Dear <b>Acme Foundation</b> — my own wording.</p>',
            editedFrom: secondVersionId,
        },
    });
    check('a real edit creates a version', edited.structuredContent?.versionCount === 3, edited.structuredContent);

    const afterEdit = (await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } }))
        .structuredContent;
    const userVersion = afterEdit?.versions?.at(-1);
    check('the edit is attributed to the user', userVersion?.source === 'user', userVersion?.source);
    check('the edit records what it came from', userVersion?.editedFrom === secondVersionId, userVersion?.editedFrom);
    check('presentational tags are normalised', userVersion?.html?.includes('<strong>Acme Foundation</strong>'), userVersion?.html);

    const feedback = await client.callTool({
        name: 'submit_feedback',
        arguments: {
            sessionId: generationSessionId,
            versionId: secondVersionId,
            feedback: 'like',
            tag: 'Used my context well',
        },
    });
    check('feedback is recorded', feedback.structuredContent?.tag === 'Used my context well', feedback.structuredContent);

    const duplicate = await client.callTool({
        name: 'submit_feedback',
        arguments: { sessionId: generationSessionId, versionId: secondVersionId, feedback: 'like', tag: 'Too generic' },
    });
    check('a second rating on the same version is rejected', duplicate.isError === true);

    const badTag = await client.callTool({
        name: 'submit_feedback',
        arguments: { sessionId: generationSessionId, versionId: userVersion?.id, feedback: 'like', tag: 'Too generic' },
    });
    // "Too generic" is a dislike tag; a mismatched pair would poison the analytics
    // the tags exist for.
    check('a tag from the other rating is rejected', badTag.isError === true);
    check(
        'the rejection carries its error code',
        badTag.content?.[0]?.text?.includes('INVALID_FEEDBACK_TAG'),
        badTag.content?.[0]?.text,
    );

    const unknownVersion = await client.callTool({
        name: 'submit_feedback',
        arguments: {
            sessionId: generationSessionId,
            versionId: 'not-a-version',
            feedback: 'like',
            tag: 'Clear impact + metrics',
        },
    });
    check('feedback on an unknown version is rejected', unknownVersion.isError === true);

    const copied = await client.callTool({
        name: 'track_copy',
        arguments: { sessionId: generationSessionId, versionId: userVersion?.id },
    });
    check('a copy is counted', copied.structuredContent?.copyCount === 1, copied.structuredContent);

    const withEvents = (await client.callTool({ name: 'get_session', arguments: { sessionId: generationSessionId } }))
        .structuredContent;
    check('events reach the panel', withEvents?.eventCount === 2, withEvents?.eventCount);
    check(
        'the rated version carries its tag',
        withEvents?.versions?.find(v => v.id === secondVersionId)?.feedbackTag === 'Used my context well',
        withEvents?.versions?.map(v => v.feedbackTag),
    );
    check(
        'the copied version carries its count',
        withEvents?.versions?.find(v => v.id === userVersion?.id)?.copyCount === 1,
        withEvents?.versions?.map(v => v.copyCount),
    );

    console.log('\nGeneration errors');
    const unknownSessionCall = await client.callTool({
        name: 'request_generation',
        arguments: { sessionId: 'does-not-exist' },
    });
    check('unknown session is an MCP error', unknownSessionCall.isError === true, unknownSessionCall.isError);

    // The panel edits rich text through `contenteditable`, which rewrites its own
    // markup as the user types. Only a change to the words is a new version.
    console.log('\nEdit normalisation');
    const { sessionStore } = await import('../dist/store/session-store.js');
    const s = sessionStore.create({});
    sessionStore.addVersion(s.id, '<p>First draft text.</p>', 'gpt');

    sessionStore.saveEdit(s.id, '<p>First   draft text.<br></p>');
    check('reflowed markup creates no version', s.versions.length === 1, s.versions.length);

    sessionStore.saveEdit(s.id, '<p>First draft text, edited.</p>');
    check('changed wording creates a version', s.versions.length === 2, s.versions.length);

    // A generation that misses its deadline is not a generation that can never
    // land: the model may answer late, and the panel's "Check again" button is
    // worth nothing if the server has already closed the door.
    console.log('\nLate drafts');
    const late = sessionStore.create({});
    late.status = 'failed';
    late.failureReason = 'GENERATION_TIMEOUT';

    sessionStore.addVersion(late.id, '<p>Arrived late.</p>', 'gpt');
    check('a late draft is accepted', late.versions.length === 1, late.versions.length);
    check('a late draft revives the session', late.status === 'ready', late.status);
    check('the failure reason is cleared', late.failureReason === undefined, late.failureReason);

    console.log('\nFallback drafts');
    const { workspace } = await import('../dist/data/workspace.js');
    const exact = workspace.fallbackDraft('dt-thank-you-letter', 'recfbSXdGVStsacWl');
    check('exact fallback matches', exact?.documentTypeId === 'dt-thank-you-letter', exact?.documentTypeId);
    const generic = workspace.fallbackDraft('dt-grant-report', 'no-such-funder');
    check('falls back to the generic draft', generic?.documentTypeId === '*', generic?.documentTypeId);
    check('fallback drafts have real text', (generic?.text?.length ?? 0) > 400, generic?.text?.length);

    console.log('\nSpike metrics');
    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    check('two attempts recorded', stats.overall.attempts === 2, stats.overall);
    check('both rendered', stats.overall.rendered === 2, stats.overall);
    check('success rate is 1', stats.overall.successRate === 1, stats.overall.successRate);
    check('variant is attributed', stats.byVariant['ui-tool-call'].attempts === 1, stats.byVariant);
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
