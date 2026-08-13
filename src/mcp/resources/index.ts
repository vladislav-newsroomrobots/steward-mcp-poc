import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Registers MCP resources. The `ui://steward/app.html` MCP Apps resource is
 * added in stage 1 together with `open_steward`.
 */
export function registerResources(_server: McpServer): void {
    // intentionally empty — see docs/steward-chatgpt-mcp-implementation/01-chatgpt-connectivity.md
}
