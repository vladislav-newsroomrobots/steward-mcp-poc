import { readFile } from 'node:fs/promises';

import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { UI_HTML_PATH } from '../../paths.js';

/** URI the host loads to render the Steward panel. */
export const STEWARD_APP_URI = 'ui://steward/app.html';

/**
 * Serves the single-file widget built by `npm run build:ui`.
 *
 * The file is read per request rather than cached at startup so rebuilding the
 * UI takes effect without restarting the server.
 */
export function registerStewardAppResource(server: McpServer): void {
    registerAppResource(
        server,
        'Steward App',
        STEWARD_APP_URI,
        { description: 'The Steward drafting interface.' },
        async () => {
            let html: string;

            try {
                html = await readFile(UI_HTML_PATH, 'utf8');
            } catch (cause) {
                throw new Error(
                    `Steward UI bundle is missing at ${UI_HTML_PATH}. Run "npm run build:ui" first.`,
                    { cause },
                );
            }

            return {
                contents: [{ uri: STEWARD_APP_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
            };
        },
    );
}
