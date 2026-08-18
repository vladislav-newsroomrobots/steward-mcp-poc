import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workspace } from '../../data/workspace.js';
import { StewardError } from '../../errors.js';
import { withToolLogging } from '../with-tool-logging.js';

interface LinkedObjectsInput {
    funderIds?: string[];
    dealIds?: string[];
}

/**
 * The link between funders and opportunities, followed in either direction.
 *
 * Funders resolve to their opportunities, matching
 * `GET /platform/funders/:id/deals` in the backend; opportunities resolve back
 * to the funders behind them. The panel needs both because either side can be
 * chosen first, and picking one pulls the other in.
 *
 * Ids are followed one hop only. Funders returned for an opportunity do not
 * then drag in their other opportunities — that would turn one click into a
 * sweep of the graph.
 */
export function registerGetLinkedObjectsTool(server: McpServer): void {
    registerAppTool(
        server,
        'get_linked_objects',
        {
            title: 'Get linked funders and opportunities',
            description:
                'Follows the link between funders and opportunities. Pass funderIds to get the opportunities (deals) linked to them — grants, pledges and sponsorships, with their pipeline stage — or dealIds to get the funders behind those opportunities. Both may be passed at once.',
            inputSchema: {
                funderIds: z.array(z.string()).optional(),
                dealIds: z.array(z.string()).optional(),
            },
            outputSchema: {
                opportunities: z.array(
                    z.object({
                        id: z.string(),
                        title: z.string(),
                        stage: z.string().optional(),
                        isPrimary: z.boolean().optional(),
                    }),
                ),
                funders: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                        lastGrantAmount: z.string().optional(),
                    }),
                ),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('get_linked_objects', ({ funderIds = [], dealIds = [] }: LinkedObjectsInput) => {
            if (funderIds.length === 0 && dealIds.length === 0) {
                throw new StewardError(
                    'MISSING_GENERATION_INPUT',
                    'Pass funderIds, dealIds, or both — there is nothing to follow otherwise',
                );
            }

            const payload = {
                opportunities: workspace.linkedDeals(funderIds),
                funders: workspace.linkedFunders(dealIds),
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
