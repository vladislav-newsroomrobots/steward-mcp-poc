import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerOpenStewardTool } from './open-steward.js';
import { registerPingTool } from './ping.js';

/**
 * Registers every Steward MCP tool on a per-session server instance.
 *
 * `ping` is a connectivity probe with no Steward logic; the SDK advertises the
 * tools capability lazily, so a server with zero tools cannot answer
 * `tools/list` at all. Generation tools arrive in stage 2.
 */
export function registerTools(server: McpServer): void {
    registerPingTool(server);
    registerOpenStewardTool(server);
}
