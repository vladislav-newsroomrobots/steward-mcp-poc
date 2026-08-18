import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { StewardError } from '../../errors.js';
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
 *
 * `text` is optional so that showing a draft again is cheap. Several turns
 * later the model is no longer holding the document, and a tool that demanded
 * it back would push the model towards whichever panel needs no arguments —
 * which is how "show me the draft" ended up opening the drafting form. Called
 * with a sessionId alone, this re-opens the stored version.
 */
export function registerRenderDraftTool(server: McpServer): void {
    registerAppTool(
        server,
        'render_draft',
        {
            title: 'Show the Steward draft',
            description:
                'Shows a Steward draft in its own panel. This is the only way to display a document — never paste one into the chat, and never open the drafting form to show an existing draft. Pass the full text with the sessionId the first time, right after the user says yes to seeing it; pass the sessionId alone at any point afterwards to re-open the stored draft. Call list_sessions first if you do not know the sessionId.',
            inputSchema: {
                sessionId: z.string(),
                text: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                        'The document you just wrote. Omit it to re-open the version already stored for this session.',
                    ),
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
        withToolLogging('render_draft', ({ sessionId, text }: { sessionId: string; text?: string }) => {
            const session =
                text === undefined
                    ? sessionStore.require(sessionId)
                    : sessionStore.addVersion(sessionId, text, 'gpt');

            const version = session.versions.at(-1);

            if (!version) {
                throw new StewardError(
                    'VERSION_NOT_FOUND',
                    `Session ${sessionId} has no stored draft yet — pass the text you wrote`,
                );
            }

            // Only a new document closes a brief. Re-showing one would otherwise
            // mark the next, unanswered brief as rendered.
            const run = text === undefined ? undefined : runLog.markRendered(sessionId);

            logger.info('draft rendered', {
                sessionId,
                versionId: version.id,
                versionCount: session.versions.length,
                words: version.text.trim().split(/\s+/).length,
                reopened: text === undefined,
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
