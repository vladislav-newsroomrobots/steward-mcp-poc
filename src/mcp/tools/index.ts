import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCreateSessionTool } from './create-session.js';
import { registerGetLinkedObjectsTool } from './get-linked-objects.js';
import { registerGetSessionTool } from './get-session.js';
import { registerGetWorkspaceTool } from './get-workspace.js';
import { registerOpenStewardTool } from './open-steward.js';
import { registerPingTool } from './ping.js';
import { registerRequestGenerationTool } from './request-generation.js';

/**
 * Registers every Steward MCP tool on a per-session server instance.
 *
 * Visibility is set per tool through `_meta.ui.visibility`: session plumbing is
 * hidden from the model so it cannot wander into it. Nothing here receives a
 * finished draft — the model writes it in the conversation and shows it there.
 */
export function registerTools(server: McpServer): void {
    registerPingTool(server);
    registerOpenStewardTool(server);
    registerGetWorkspaceTool(server);
    registerGetLinkedObjectsTool(server);
    registerCreateSessionTool(server);
    registerRequestGenerationTool(server);
    registerGetSessionTool(server);
}
