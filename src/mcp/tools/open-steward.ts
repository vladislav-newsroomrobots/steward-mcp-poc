import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STEWARD_APP_URI } from '../resources/steward-app.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Entry point of the app: renders the Steward panel in the conversation.
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
                'Opens the Steward drafting interface in the conversation. Call this whenever the user wants to write, refine or review a communication to a funder. Pass funderId when the user named a funder you already know the id of.',
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
