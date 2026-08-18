import { readFile } from 'node:fs/promises';

import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { uiHtmlPath } from '../../paths.js';

interface Widget {
    /** URI the host loads to render this panel. */
    uri: string;
    title: string;
    description: string;
    /** Basename under `ui/dist/`, written by `npm run build:ui`. */
    file: string;
}

/** The Steward panel: workspace context and the request that starts a draft. */
export const STEWARD_APP_URI = 'ui://steward/app.html';

/** One finished document, opened by `render_draft`. */
export const STEWARD_DRAFT_URI = 'ui://steward/draft.html';

/** Every drafting session in the workspace, opened by `list_sessions`. */
export const STEWARD_SESSIONS_URI = 'ui://steward/sessions.html';

const WIDGETS: Widget[] = [
    {
        uri: STEWARD_APP_URI,
        title: 'Steward App',
        description: 'The Steward drafting interface.',
        file: 'app',
    },
    {
        uri: STEWARD_DRAFT_URI,
        title: 'Steward Draft',
        description: 'A document the model wrote, shown on its own.',
        file: 'draft',
    },
    {
        uri: STEWARD_SESSIONS_URI,
        title: 'Steward Sessions',
        description: 'Every drafting session in this workspace.',
        file: 'sessions',
    },
];

/**
 * Serves the single-file widgets built by `npm run build:ui`.
 *
 * Each file is read per request rather than cached at startup so rebuilding the
 * UI takes effect without restarting the server.
 */
export function registerWidgetResources(server: McpServer): void {
    for (const widget of WIDGETS) {
        registerAppResource(
            server,
            widget.title,
            widget.uri,
            { description: widget.description },
            async () => {
                const path = uiHtmlPath(widget.file);
                let html: string;

                try {
                    html = await readFile(path, 'utf8');
                } catch (cause) {
                    throw new Error(
                        `Steward UI bundle is missing at ${path}. Run "npm run build:ui" first.`,
                        { cause },
                    );
                }

                return {
                    contents: [{ uri: widget.uri, mimeType: RESOURCE_MIME_TYPE, text: html }],
                };
            },
        );
    }
}
