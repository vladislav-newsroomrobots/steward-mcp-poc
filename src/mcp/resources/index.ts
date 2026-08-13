import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerStewardAppResource } from './steward-app.js';

/** Registers MCP resources, including the MCP Apps widget the host renders. */
export function registerResources(server: McpServer): void {
    registerStewardAppResource(server);
}
