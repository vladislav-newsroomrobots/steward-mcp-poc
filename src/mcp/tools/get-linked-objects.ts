import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workspace } from '../../data/workspace.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * One hop from a funder to its opportunities, matching
 * `GET /platform/funders/:id/deals` in the backend.
 *
 * Loaded lazily when a funder is picked rather than shipped with the workspace,
 * exactly as the extension does it — the full deal graph is far larger than any
 * one session needs.
 */
export function registerGetLinkedObjectsTool(server: McpServer): void {
    registerAppTool(
        server,
        'get_linked_objects',
        {
            title: 'Get funder opportunities',
            description:
                'Returns the opportunities (deals) linked to a funder — grants, pledges and sponsorships, with their pipeline stage.',
            inputSchema: { funderId: z.string() },
            outputSchema: {
                funderId: z.string(),
                opportunities: z.array(
                    z.object({
                        id: z.string(),
                        title: z.string(),
                        stage: z.string().optional(),
                        isPrimary: z.boolean().optional(),
                    }),
                ),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('get_linked_objects', ({ funderId }: { funderId: string }) => {
            const payload = { funderId, opportunities: workspace.linkedDeals(funderId) };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
