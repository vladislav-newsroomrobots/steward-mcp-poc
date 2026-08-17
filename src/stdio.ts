import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { describeError, logger } from './logger.js';
import { createStewardMcpServer } from './mcp/create-server.js';

/**
 * stdio entry point, for hosts that launch the server as a child process
 * (Claude Desktop) rather than connecting to an HTTP endpoint.
 *
 * The tools and the MCP Apps resource are identical to the HTTP server — only
 * the transport differs. Note that stdout belongs to the protocol here: every
 * log line goes to stderr, which is why the logger was written that way.
 */
const server = createStewardMcpServer();
const transport = new StdioServerTransport()

await server.connect(transport);

logger.info('steward mcp server ready on stdio');

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info('shutting down', { signal });

    try {
        await server.close();
        process.exit(0);
    } catch (error) {
        logger.error('shutdown failed', describeError(error));
        process.exit(1);
    }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        void shutdown(signal);
    });
}

process.on('uncaughtException', error => {
    logger.error('uncaught exception', describeError(error));
    process.exit(1);
});
