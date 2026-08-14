import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Lets the widget read session state.
 *
 * `render_draft` is called by the model, server-side, so the widget has no way
 * to be told directly that a draft arrived — it polls this while generating.
 * Hidden from the model, which has no reason to call it.
 */
export function registerGetSessionTool(server: McpServer): void {
    registerAppTool(
        server,
        'get_session',
        {
            title: 'Get Steward session',
            description:
                'Returns the current state of a Steward drafting session, including its draft versions. Used by the Steward interface.',
            inputSchema: { sessionId: z.string() },
            outputSchema: {
                sessionId: z.string(),
                status: z.string(),
                versionCount: z.number(),
                latestDraft: z.string().nullable(),
                failureReason: z.string().optional(),
            },
            annotations: { readOnlyHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['app'] } },
        },
        withToolLogging('get_session', ({ sessionId }: { sessionId: string }) => {
            const session = sessionStore.require(sessionId);
            const latest = session.versions.at(-1);

            const payload = {
                sessionId: session.id,
                status: session.status,
                versionCount: session.versions.length,
                latestDraft: latest?.text ?? null,
                ...(session.failureReason === undefined ? {} : { failureReason: session.failureReason }),
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
