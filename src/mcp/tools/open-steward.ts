import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STEWARD_APP_URI } from '../resources/widgets.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Entry point of the app: renders the drafting form in the conversation.
 *
 * The description deliberately does not cover showing a draft. It used to say
 * "write, refine or review", which made it the best match for "show me the
 * draft" as well — and the user got this form instead of the document. Each
 * panel now names itself and points at the other.
 *
 * `funderId` is optional and only a hint — stage 1 echoes it back so the UI can
 * preselect a funder once fixtures exist (stage 3).
 */
export function registerOpenStewardTool(server: McpServer): void {
    registerAppTool(
        server,
        'open_steward',
        {
            title: 'Open Steward',
            description:
                'Opens the Steward drafting form — document type, funders, opportunities and the request — so the user can start a new document. Call it when they want to write or rewrite something and no session is under way. This form never displays a draft: to show a document that already exists, call render_draft instead. Pass funderId when the user named a funder you already know the id of.',
            inputSchema: { funderId: z.string().optional() },
            outputSchema: { opened: z.boolean(), funderId: z.string().optional() },
            annotations: { readOnlyHint: true, openWorldHint: false },
            _meta: { ui: { resourceUri: STEWARD_APP_URI } },
        },
        withToolLogging('open_steward', ({ funderId }: { funderId?: string }) => {
            const payload = { opened: true, ...(funderId === undefined ? {} : { funderId }) };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: 'The Steward interface is open in the conversation. The user drives it from there; do not describe the panel back to them.',
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
