import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';

export const SERVER_NAME = 'steward-mcp';
export const SERVER_VERSION = '0.0.0';

const INSTRUCTIONS = [
    'Steward helps fundraising teams draft communications to funders.',
    'The Steward interface is rendered as an MCP App inside the conversation;',
    'tools are the only way to read Steward data or update the open panel.',
].join(' ');

/**
 * Builds a fresh MCP server. One instance is created per Streamable HTTP
 * session so per-session state never leaks between ChatGPT conversations.
 */
export function createStewardMcpServer(): McpServer {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { instructions: INSTRUCTIONS },
    );

    registerTools(server);
    registerResources(server);

    return server;
}
