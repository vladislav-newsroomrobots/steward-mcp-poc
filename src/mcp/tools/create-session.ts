import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

/** Opens a drafting session. Called by the widget, never by the model. */
export function registerCreateSessionTool(server: McpServer): void {
    registerAppTool(
        server,
        'create_session',
        {
            title: 'Create Steward session',
            description:
                'Creates a Steward drafting session and returns its id. Called by the Steward interface when the user starts a document.',
            inputSchema: {
                documentTypeId: z.string().optional(),
                funderIds: z.array(z.string()).optional(),
                dealIds: z.array(z.string()).optional(),
                userRequest: z.string().optional(),
                wordLimit: z.number().int().positive().max(5000).optional(),
            },
            outputSchema: { sessionId: z.string(), status: z.string() },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['app'] } },
        },
        withToolLogging('create_session', (input: Record<string, unknown>) => {
            const session = sessionStore.create(
                Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
            );
            const payload = { sessionId: session.id, status: session.status };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
