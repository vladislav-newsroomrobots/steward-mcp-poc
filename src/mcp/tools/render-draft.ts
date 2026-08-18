import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../../logger.js';
import { runLog } from '../../store/run-log.js';
import { sessionStore } from '../../store/session-store.js';
import { STEWARD_DRAFT_URI } from '../resources/widgets.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Closes the generation cycle: the model hands back the document it wrote, the
 * version is stored, and the draft opens in its own panel.
 *
 * It is called after the user has said yes, not instead of asking. The model
 * writes the document first and offers it; this is what the offer resolves to,
 * which is why the text arrives whole rather than being streamed into the chat.
 */
export function registerRenderDraftTool(server: McpServer): void {
    registerAppTool(
        server,
        'render_draft',
        {
            title: 'Show the Steward draft',
            description:
                'Shows a document you wrote in its own Steward panel, and stores it as a version. Call it once the user has said yes to seeing the draft, passing the full text and the sessionId from the request_generation brief. Use this rather than pasting the document into the chat.',
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
            _meta: { ui: { resourceUri: STEWARD_DRAFT_URI, visibility: ['model'] } },
        },
        withToolLogging('render_draft', ({ sessionId, text }: { sessionId: string; text: string }) => {
            const session = sessionStore.addVersion(sessionId, text, 'gpt');
            const version = session.versions.at(-1)!;
            const run = runLog.markRendered(sessionId);

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
                        text: 'The draft is now open in its own Steward panel. Reply with one short sentence and do not repeat the document in the chat.',
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
