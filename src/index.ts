import { describeError, logger } from './logger.js';
import { startServer } from './server.js';

const SHUTDOWN_TIMEOUT_MS = 5_000;

const running = await startServer();

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
        logger.warn('shutdown already in progress, ignoring signal', { signal });
        return;
    }
    shuttingDown = true;

    logger.info('shutting down', { signal });

    // Never let a stuck connection keep the process alive forever.
    const forceExit = setTimeout(() => {
        logger.error('graceful shutdown timed out, forcing exit', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
        await running.close();
        clearTimeout(forceExit);
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

process.on('unhandledRejection', reason => {
    logger.error('unhandled promise rejection', describeError(reason));
});

process.on('uncaughtException', error => {
    logger.error('uncaught exception', describeError(error));
    process.exit(1);
});
