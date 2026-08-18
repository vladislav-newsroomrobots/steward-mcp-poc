import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';

export const SERVER_NAME = 'steward-mcp';
export const SERVER_VERSION = '0.0.0';

/**
 * Shared instructions every session receives. The generation workflow is spelled
 * out here as well as in the individual tool descriptions: the model stopping
 * after `request_generation` is the one failure that breaks the product, so it
 * is worth stating in every place the model reads.
 */
const INSTRUCTIONS = [
    'Steward helps fundraising teams draft communications to funders.',
    'The Steward interface is rendered as an MCP App inside the conversation;',
    'tools are the only way to read Steward data or open the panel.',
    '',
    'Generating a document works like this, and you are the generator:',
    '1. request_generation returns a brief — what to write, for whom, and how long.',
    '2. Do not stop after receiving the brief, and do not summarise it back to the user.',
    '3. Write the complete document yourself, respecting the instructions and word limit.',
    '4. There is no tool that takes the draft. It stays in the conversation, written by you.',
    '5. Do not print it straight away: say the draft is ready and ask whether to show it.',
    '6. When the user says yes, print the full document in the chat.',
    '',
    'The panel is context only — funders, opportunities, document types and session',
    'state. It never displays the draft, so never tell the user to look for it there.',
].join('\n');

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
