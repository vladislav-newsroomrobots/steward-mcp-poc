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
    'tools are the only way to read Steward data or update the open panel.',
    '',
    'Generating a document works like this, and you are the generator:',
    '1. request_generation returns a brief — what to write, for whom, how long and in what format.',
    '2. Do not stop after receiving the brief, and do not summarise it back to the user.',
    '3. Write the complete document yourself, respecting the instructions and word limit.',
    '4. Call render_draft with the full document and the same sessionId.',
    '5. Prefer render_draft over putting the document in your chat reply; the user',
    '   reads it in the panel. Keep the chat reply to one short sentence.',
    '',
    'Drafts are rich text in a small canonical subset of HTML — paragraphs, headings,',
    'lists, blockquotes and basic emphasis. The panel renders it; a wall of plain text',
    'loses the structure the document needs.',
    '',
    'After a draft exists, the user owns it: save_edit stores wording they supplied',
    'themselves, submit_feedback records a rating and requires one of the product tags,',
    'and the panel tracks copies. Never rate a draft on your own initiative.',
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
