import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../../logger.js';
import { runLog } from '../../store/run-log.js';
import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Closes the generation cycle: the model hands back the document it wrote, the
 * version is stored, and the widget picks it up on its next poll.
 */
export function registerRenderDraftTool(server: McpServer): void {
    registerAppTool(
        server,
        'render_draft',
        {
            title: 'Render Steward draft',
            description:
                'Stores the completed document you generated and displays it in the Steward panel. Call this immediately after writing a document for a request_generation brief, passing the full text and the sessionId from that brief. Prefer this over putting the document in your chat reply.',
            inputSchema: {
                sessionId: z.string(),
                text: z.string().min(1),
            },
            outputSchema: {
                sessionId: z.string(),
                versionId: z.string(),
                versionCount: z.number(),
                status: z.string(),
            },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['model'] } },
        },
        withToolLogging('render_draft', ({ sessionId, text }: { sessionId: string; text: string }) => {
            const session = sessionStore.addVersion(sessionId, text, 'gpt');
            const version = session.versions.at(-1)!;
            const run = runLog.complete(sessionId);

            logger.info('draft rendered', {
                sessionId,
                versionId: version.id,
                versionCount: session.versions.length,
                words: text.trim().split(/\s+/).length,
                runId: run?.runId,
                generationMs: run?.durationMs,
            });

            const payload = {
                sessionId: session.id,
                versionId: version.id,
                versionCount: session.versions.length,
                status: session.status,
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: 'The draft is now shown in the Steward panel. Reply with one short sentence and do not repeat the document in the chat.',
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
