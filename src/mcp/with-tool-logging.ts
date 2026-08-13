import { describeError, logger } from '../logger.js';

/**
 * Wraps a tool callback so every invocation logs tool name, MCP session and
 * duration. Tools are registered as
 * `server.registerTool(name, config, withToolLogging(name, handler))`
 * so the logging requirement cannot be forgotten per tool.
 */
export function withToolLogging<Args extends unknown[], Result>(
    name: string,
    handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
    return async (...args: Args): Promise<Result> => {
        const extra = args.at(-1) as { sessionId?: string; requestId?: string | number } | undefined;
        const log = logger.child({
            tool: name,
            sessionId: extra?.sessionId,
            requestId: extra?.requestId,
        });

        const startedAt = process.hrtime.bigint();
        const elapsedMs = (): number => Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);

        log.debug('tool started');

        try {
            const result = await handler(...args);
            log.info('tool finished', { durationMs: elapsedMs() });
            return result;
        } catch (error) {
            log.error('tool failed', { durationMs: elapsedMs(), ...describeError(error) });
            throw error;
        }
    };
}
