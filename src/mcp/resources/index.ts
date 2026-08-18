import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerWidgetResources } from './widgets.js';

/** Registers MCP resources, including the MCP Apps widgets the host renders. */
export function registerResources(server: McpServer): void {
    registerWidgetResources(server);
}
