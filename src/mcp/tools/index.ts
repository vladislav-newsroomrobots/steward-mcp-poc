import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPingTool } from './ping.js';

/**
 * Registers every Steward MCP tool on a per-session server instance.
 *
 * Stage 0 ships only `ping`: the SDK advertises the tools capability lazily, so
 * a server with no tools answers `tools/list` with "method not found" and is
 * not discoverable by a test client. `open_steward` arrives in stage 1, the
 * generation tools in stage 2.
 */
export function registerTools(server: McpServer): void {
    registerPingTool(server);
}
