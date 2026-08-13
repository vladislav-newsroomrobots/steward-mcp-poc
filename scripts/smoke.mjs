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
