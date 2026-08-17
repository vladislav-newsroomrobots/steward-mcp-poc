import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { StewardError } from '../../errors.js';
import { CANONICAL_FORMAT_HINT, toCanonicalHtml, wordCount } from '../../generation/canonical-html.js';
import { logger } from '../../logger.js';
import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

interface SaveEditInput {
    sessionId: string;
    html: string;
    editedFrom?: string;
}

/**
 * A manual edit becomes a version of its own, attributed to the user.
 *
 * Rewriting the stored draft in place would erase what the model produced, and
 * the point of the version trail is being able to see which words are whose.
 * `editedFrom` records the version the user was looking at, which is not always
 * the latest one.
 *
 * Visible to the model too: E1 in the walkthrough is a user pasting their own
 * rewrite into the chat and asking for it to be saved.
 */
export function registerSaveEditTool(server: McpServer): void {
    registerAppTool(
        server,
        'save_edit',
        {
            title: 'Save a Steward draft edit',
            description:
                "Saves a manually edited draft as a new version of a Steward session, attributed to the user. Use it when the user supplies their own wording rather than asking you to rewrite; a draft you wrote yourself belongs in render_draft.",
            inputSchema: {
                sessionId: z.string(),
                html: z.string().min(1).describe(`The edited document in ${CANONICAL_FORMAT_HINT}`),
                editedFrom: z
                    .string()
                    .optional()
                    .describe('Id of the version that was edited. Defaults to the latest version.'),
            },
            outputSchema: {
                sessionId: z.string(),
                versionId: z.string(),
                versionCount: z.number(),
                words: z.number(),
                unchanged: z.boolean(),
            },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('save_edit', ({ sessionId, html, editedFrom }: SaveEditInput) => {
            const canonical = toCanonicalHtml(html);

            if (canonical === '') {
                throw new StewardError('EMPTY_DRAFT', 'The edited draft contained no renderable content');
            }

            const before = sessionStore.require(sessionId).versions.length;
            const session = sessionStore.saveEdit(sessionId, canonical, editedFrom);
            const version = session.versions.at(-1)!;
            const unchanged = session.versions.length === before;

            logger.info(unchanged ? 'edit discarded as unchanged' : 'edit saved', {
                sessionId,
                versionId: version.id,
                versionCount: session.versions.length,
            });

            const payload = {
                sessionId: session.id,
                versionId: version.id,
                versionCount: session.versions.length,
                words: wordCount(version.html),
                unchanged,
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: unchanged
                            ? 'The edit matched the version it came from, so no new version was created.'
                            : `Saved as version ${session.versions.length}, marked as the user's edit. It is shown in the Steward panel.`,
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
