import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { StewardError } from '../../errors.js';
import { CANONICAL_FORMAT_HINT, toCanonicalHtml, wordCount } from '../../generation/canonical-html.js';
import { logger } from '../../logger.js';
import { runLog } from '../../store/run-log.js';
import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

interface RenderDraftInput {
    sessionId: string;
    html?: string;
    /** Legacy name for `html`; see the handler. */
    text?: string;
}

/**
 * Closes the generation cycle: the model hands back the document it wrote, the
 * version is stored, and the widget picks it up on its next poll.
 *
 * A draft is accepted even after the session's deadline has passed: a late
 * document is worth more than a tidy status, and the panel's **Check again**
 * button exists to pick it up.
 */
export function registerRenderDraftTool(server: McpServer): void {
    registerAppTool(
        server,
        'render_draft',
        {
            title: 'Render Steward draft',
            description:
                'Stores the completed document you generated and displays it in the Steward panel. Call this immediately after writing a document for a request_generation brief, passing the full document and the sessionId from that brief. Prefer this over putting the document in your chat reply.',
            inputSchema: {
                sessionId: z.string(),
                html: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(`The complete document in ${CANONICAL_FORMAT_HINT}`),
                text: z
                    .string()
                    .min(1)
                    .optional()
                    .describe('Deprecated alias for html, accepted so an older tool list still works. Prefer html.'),
            },
            outputSchema: {
                sessionId: z.string(),
                versionId: z.string(),
                versionCount: z.number(),
                words: z.number(),
                status: z.string(),
            },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['model'] } },
        },
        withToolLogging('render_draft', ({ sessionId, html, text }: RenderDraftInput) => {
            if (html === undefined && text !== undefined) {
                // A host that cached the tool list before this parameter was renamed
                // would otherwise fail schema validation inside the SDK — before
                // this handler, before any logging, leaving a generation that looks
                // like the model simply never answered. Accepting the old name
                // costs nothing; hiding it would cost a debugging session, so it is
                // loud in the log.
                logger.warn('render_draft called with the legacy text parameter', {
                    sessionId,
                    hint: 'The caller has a stale tool list — re-scan the connector.',
                });
            }

            const document = html ?? text;

            if (document === undefined) {
                throw new StewardError('EMPTY_DRAFT', 'Pass the document in html');
            }

            // Sanitized before it is stored, not before it is shown: the panel is
            // one consumer, and phase 2 adds others (email, Docs, the platform).
            const canonical = toCanonicalHtml(document);

            if (canonical === '') {
                throw new StewardError('EMPTY_DRAFT', 'The draft contained no renderable content');
            }

            const session = sessionStore.addVersion(sessionId, canonical, 'gpt');
            const version = session.versions.at(-1)!;
            const run = runLog.complete(sessionId);
            const words = wordCount(canonical);

            logger.info('draft rendered', {
                sessionId,
                versionId: version.id,
                versionCount: session.versions.length,
                words,
                runId: run?.runId,
                generationMs: run?.durationMs,
            });

            const payload = {
                sessionId: session.id,
                versionId: version.id,
                versionCount: session.versions.length,
                words,
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
