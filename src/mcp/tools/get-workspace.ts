import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workspace } from '../../data/workspace.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Everything the panel needs on load.
 *
 * Opportunities are in here as well as funders: the panel lets either side be
 * picked first, so both lists have to be on screen before anything is chosen.
 * Which funder an opportunity belongs to is not included — that link is a
 * separate hop through `get_linked_objects`, as it is in the backend.
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
                'Returns the funders, opportunities and document types available in this Steward workspace. Use it to resolve a funder, opportunity or document type the user named into an id.',
            outputSchema: {
                documentTypes: z.array(
                    z.object({ id: z.string(), name: z.string(), tips: z.array(z.string()) }),
                ),
                funders: z.array(
                    z.object({ id: z.string(), name: z.string(), lastGrantAmount: z.string().optional() }),
                ),
                opportunities: z.array(
                    z.object({ id: z.string(), title: z.string(), stage: z.string().optional() }),
                ),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('get_workspace', () => {
            const { documentTypes, funders, deals } = workspace.summary();

            const payload = {
                documentTypes: documentTypes.map(({ id, name, tips }) => ({ id, name, tips })),
                funders: funders.map(({ id, name, lastGrantAmount }) => ({
                    id,
                    name,
                    ...(lastGrantAmount === undefined ? {} : { lastGrantAmount }),
                })),
                opportunities: deals.map(({ id, title, stage }) => ({
                    id,
                    title,
                    ...(stage === undefined ? {} : { stage }),
                })),
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
