import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Records that a version left the panel for the clipboard.
 *
 * The most honest quality signal the product has: a draft that gets copied is a
 * draft that got used, whatever the user pressed on the 👍/👎 buttons. The
 * clipboard write itself happens in the widget — this only counts it.
 *
 * App-only: the model cannot know when the user copies something.
 */
export function registerTrackCopyTool(server: McpServer): void {
    registerAppTool(
        server,
        'track_copy',
        {
            title: 'Track a Steward copy',
            description:
                'Records that the user copied a draft version to the clipboard. Called by the Steward interface.',
            inputSchema: { sessionId: z.string(), versionId: z.string() },
            outputSchema: { sessionId: z.string(), versionId: z.string(), copyCount: z.number() },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['app'] } },
        },
        withToolLogging('track_copy', ({ sessionId, versionId }: { sessionId: string; versionId: string }) => {
            const session = sessionStore.addCopyEvent(sessionId, versionId);

            const payload = {
                sessionId: session.id,
                versionId,
                copyCount: session.events.filter(event => event.kind === 'copy' && event.versionId === versionId)
                    .length,
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
