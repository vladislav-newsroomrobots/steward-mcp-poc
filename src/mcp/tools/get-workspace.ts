import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { FEEDBACK_TAGS } from '../../data/feedback-tags.js';
import { workspace } from '../../data/workspace.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Everything the panel needs on load.
 *
 * Visible to the model as well as the widget: when a user names a funder in
 * chat, the model needs the list to resolve it to an id before opening Steward.
 * `systemInstructions` are omitted from the response — they are prompt material
 * the server injects into the brief, not something the model should paraphrase
 * or the user should read.
 */
export function registerGetWorkspaceTool(server: McpServer): void {
    registerAppTool(
        server,
        'get_workspace',
        {
            title: 'Get Steward workspace',
            description:
                'Returns the funders and document types available in this Steward workspace. Use it to resolve a funder or document type the user named into an id.',
            outputSchema: {
                documentTypes: z.array(
                    z.object({ id: z.string(), name: z.string(), tips: z.array(z.string()) }),
                ),
                funders: z.array(
                    z.object({ id: z.string(), name: z.string(), lastGrantAmount: z.string().optional() }),
                ),
                feedbackTags: z.object({ like: z.array(z.string()), dislike: z.array(z.string()) }),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('get_workspace', () => {
            const { documentTypes, funders } = workspace.summary();

            const payload = {
                documentTypes: documentTypes.map(({ id, name, tips }) => ({ id, name, tips })),
                funders: funders.map(({ id, name, lastGrantAmount }) => ({
                    id,
                    name,
                    ...(lastGrantAmount === undefined ? {} : { lastGrantAmount }),
                })),
                // The panel needs them to require a tag per rating; the model
                // needs them to offer the same wording when the user rates in chat.
                feedbackTags: { like: [...FEEDBACK_TAGS.like], dislike: [...FEEDBACK_TAGS.dislike] },
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
