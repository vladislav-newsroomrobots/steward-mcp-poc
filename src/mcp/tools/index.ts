import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCreateSessionTool } from './create-session.js';
import { registerGetLinkedObjectsTool } from './get-linked-objects.js';
import { registerGetSessionTool } from './get-session.js';
import { registerGetWorkspaceTool } from './get-workspace.js';
import { registerOpenStewardTool } from './open-steward.js';
import { registerPingTool } from './ping.js';
import { registerRenderDraftTool } from './render-draft.js';
import { registerRequestGenerationTool } from './request-generation.js';
import { registerSaveEditTool } from './save-edit.js';
import { registerSubmitFeedbackTool } from './submit-feedback.js';
import { registerTrackCopyTool } from './track-copy.js';

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
    registerGetWorkspaceTool(server);
    registerGetLinkedObjectsTool(server);
    registerCreateSessionTool(server);
    registerRequestGenerationTool(server);
    registerRenderDraftTool(server);
    registerGetSessionTool(server);
    registerSaveEditTool(server);
    registerSubmitFeedbackTool(server);
    registerTrackCopyTool(server);
}
