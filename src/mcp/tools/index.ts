import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCreateSessionTool } from './create-session.js';
import { registerGetSessionTool } from './get-session.js';
import { registerOpenStewardTool } from './open-steward.js';
import { registerPingTool } from './ping.js';
import { registerRenderDraftTool } from './render-draft.js';
import { registerRequestGenerationTool } from './request-generation.js';

/**
 * Registers every Steward MCP tool on a per-session server instance.
 *
 * Visibility is set per tool through `_meta.ui.visibility`: session plumbing is
 * hidden from the model so it cannot wander into it, and `render_draft` is
 * hidden from the widget because only the model produces drafts.
 */
export function registerTools(server: McpServer): void {
    registerPingTool(server);
    registerOpenStewardTool(server);
    registerCreateSessionTool(server);
    registerRequestGenerationTool(server);
    registerRenderDraftTool(server);
    registerGetSessionTool(server);
}
