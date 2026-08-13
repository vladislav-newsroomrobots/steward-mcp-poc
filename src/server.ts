import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import type { Express, Request, Response } from 'express';

import { config } from './config.js';
import { describeError, logger } from './logger.js';
import { SERVER_NAME, SERVER_VERSION, createStewardMcpServer } from './mcp/create-server.js';

const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const MCP_SESSION_HEADER = 'mcp-session-id';

/** One Streamable HTTP session: its transport plus the MCP server bound to it. */
interface McpSession {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
}

export interface RunningServer {
    readonly host: string;
    readonly port: number;
    close(): Promise<void>;
}

function jsonRpcError(code: number, message: string): unknown {
    return { jsonrpc: '2.0', error: { code, message }, id: null };
}

function readSessionHeader(req: Request): string | undefined {
    const value = req.headers[MCP_SESSION_HEADER];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function createApp(sessions: Map<string, McpSession>): Express {
    const app = express();

    // Logging goes first, ahead of the DNS-rebinding guard: a rejected Host
    // header is exactly the failure to debug when putting a tunnel in front of
    // the server, and `createMcpExpressApp` would hide it behind the guard.
    app.use((req, res, next) => {
        const requestId = randomUUID();
        res.locals.requestId = requestId;
        res.setHeader('x-request-id', requestId);

        const startedAt = process.hrtime.bigint();
        res.on('finish', () => {
            logger.info('http request', {
                requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                // Logged so a 403 from the guard below names the rejected host.
                host: req.headers.host,
                mcpSessionId: readSessionHeader(req),
                durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
            });
        });

        next();
    });

    app.use(express.json());

    // `ALLOWED_HOSTS=*` turns the guard off entirely. Ephemeral tunnels hand out
    // a new hostname on every restart, which makes an allowlist unmaintainable.
    // The trade-off: any site open in the developer's browser can then reach
    // this server on localhost, so keep it to local development.
    if (config.ALLOWED_HOSTS.includes('*')) {
        logger.warn('host header validation disabled', { allowedHosts: '*' });
    } else {
        app.use(hostHeaderValidation([...LOCALHOST_HOSTNAMES, ...config.ALLOWED_HOSTS]));
    }

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            server: SERVER_NAME,
            version: SERVER_VERSION,
            demoMode: config.DEMO_MODE,
            sessions: sessions.size,
        });
    });

    // Client → server messages, and the one request that opens a session.
    app.post('/mcp', async (req: Request, res: Response) => {
        const requestId = res.locals.requestId as string;
        const sessionId = readSessionHeader(req);

        try {
            const existing = sessionId ? sessions.get(sessionId) : undefined;
            if (existing) {
                await existing.transport.handleRequest(req, res, req.body);
                return;
            }

            if (sessionId) {
                res.status(404).json(jsonRpcError(-32001, 'Unknown MCP session'));
                return;
            }

            if (!isInitializeRequest(req.body)) {
                res.status(400).json(jsonRpcError(-32000, 'Missing MCP session ID'));
                return;
            }

            const server = createStewardMcpServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: openedSessionId => {
                    sessions.set(openedSessionId, { transport, server });
                    logger.info('mcp session opened', { requestId, mcpSessionId: openedSessionId });
                },
                onsessionclosed: closedSessionId => {
                    sessions.delete(closedSessionId);
                    logger.info('mcp session closed', { mcpSessionId: closedSessionId });
                },
            });

            transport.onclose = () => {
                if (transport.sessionId) {
                    sessions.delete(transport.sessionId);
                }
            };

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error('mcp request failed', { requestId, mcpSessionId: sessionId, ...describeError(error) });
            if (!res.headersSent) {
                res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
            }
        }
    });

    // GET opens the server→client SSE stream; DELETE terminates the session.
    const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
        const sessionId = readSessionHeader(req);
        const session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session) {
            res.status(404).json(jsonRpcError(-32001, 'Unknown or missing MCP session'));
            return;
        }

        try {
            await session.transport.handleRequest(req, res);
        } catch (error) {
            logger.error('mcp session request failed', {
                requestId: res.locals.requestId as string,
                mcpSessionId: sessionId,
                ...describeError(error),
            });
            if (!res.headersSent) {
                res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
            }
        }
    };

    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    return app;
}

function listen(app: Express, host: string, port: number): Promise<HttpServer> {
    return new Promise((resolve, reject) => {
        const httpServer = app.listen(port, host, () => {
            httpServer.off('error', reject);
            resolve(httpServer);
        });
        httpServer.once('error', reject);
    });
}

export async function startServer(): Promise<RunningServer> {
    const sessions = new Map<string, McpSession>();
    const httpServer = await listen(createApp(sessions), config.HOST, config.PORT);

    logger.info('steward mcp server listening', {
        url: `http://${config.HOST}:${config.PORT}/mcp`,
        health: `http://${config.HOST}:${config.PORT}/health`,
        demoMode: config.DEMO_MODE,
        logLevel: config.LOG_LEVEL,
    });

    return {
        host: config.HOST,
        port: config.PORT,
        async close(): Promise<void> {
            logger.info('closing mcp sessions', { sessions: sessions.size });

            // Close MCP sessions first so open SSE streams end and `close()` below
            // is not left waiting on them.
            await Promise.allSettled([...sessions.values()].map(session => session.server.close()));
            sessions.clear();

            await new Promise<void>((resolve, reject) => {
                httpServer.close(error => (error ? reject(error) : resolve()));
                httpServer.closeAllConnections();
            });

            logger.info('http server closed');
        },
    };
}
