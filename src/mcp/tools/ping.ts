import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SERVER_NAME, SERVER_VERSION } from '../create-server.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Connectivity probe. It carries no Steward logic — it exists so a test client
 * (MCP Inspector, the smoke script, and later the iframe) can prove the
 * host → tunnel → server → tool chain end to end.
 */
export function registerPingTool(server: McpServer): void {
    server.registerTool(
        'ping',
        {
            title: 'Ping Steward',
            description:
                'Connectivity check for the Steward MCP server. Returns pong. Use only to verify the connection, never as part of a drafting workflow.',
            outputSchema: {
                ok: z.boolean(),
                message: z.string(),
                server: z.string(),
                version: z.string(),
                serverTime: z.string(),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        withToolLogging('ping', () => {
            const payload = {
                ok: true,
                message: 'pong',
                server: SERVER_NAME,
                version: SERVER_VERSION,
                serverTime: new Date().toISOString(),
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
