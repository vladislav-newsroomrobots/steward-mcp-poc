import { StewardError } from '../errors.js';
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
            // A StewardError is a modelled outcome — a bad session id, a missing
            // field. Logging those at error level with a stack buries the real
            // failures during a spike run.
            if (error instanceof StewardError) {
                log.warn('tool rejected', {
                    durationMs: elapsedMs(),
                    code: error.code,
                    errorMessage: error.message,
                });

                // The SDK turns a thrown error into an `isError` result carrying
                // only the message, so the code travels in it. Both callers need
                // it: the widget reacts differently to FEEDBACK_ALREADY_GIVEN
                // than to a real failure, and the model is told in the server
                // instructions which codes not to retry.
                throw new Error(`[${error.code}] ${error.message}`, { cause: error });
            } else {
                log.error('tool failed', { durationMs: elapsedMs(), ...describeError(error) });
            }

            throw error;
        }
    };
}
