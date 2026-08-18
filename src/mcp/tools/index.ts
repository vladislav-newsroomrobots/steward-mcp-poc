import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCreateSessionTool } from './create-session.js';
import { registerGetLinkedObjectsTool } from './get-linked-objects.js';
import { registerGetSessionTool } from './get-session.js';
import { registerGetWorkspaceTool } from './get-workspace.js';
import { registerListSessionsTool } from './list-sessions.js';
import { registerOpenStewardTool } from './open-steward.js';
import { registerPingTool } from './ping.js';
import { registerRenderDraftTool } from './render-draft.js';
import { registerRequestGenerationTool } from './request-generation.js';

/**
 * Registers every Steward MCP tool on a per-session server instance.
 *
 * Visibility is set per tool through `_meta.ui.visibility`: session plumbing is
 * hidden from the model so it cannot wander into it, and `render_draft` is
 * hidden from the widget because only the model produces drafts. Three tools
 * carry a `resourceUri` and open a panel of their own — `open_steward`,
 * `render_draft` and `list_sessions`.
 */
export function registerTools(server: McpServer): void {
    registerPingTool(server);
    registerOpenStewardTool(server);
    registerGetWorkspaceTool(server);
    registerGetLinkedObjectsTool(server);
    registerCreateSessionTool(server);
    registerRequestGenerationTool(server);
    registerRenderDraftTool(server);
    registerGetSessionTool(server);
    registerListSessionsTool(server);
}
