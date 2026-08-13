import { config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const threshold = LEVEL_WEIGHT[config.LOG_LEVEL];

export type LogFields = Record<string, unknown>;

export interface Logger {
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
    /** Returns a logger that stamps `fields` onto every subsequent line. */
    child(fields: LogFields): Logger;
}

function dropUndefined(fields: LogFields): LogFields {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function write(level: LogLevel, bound: LogFields, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < threshold) {
        return;
    }

    const line = {
        time: new Date().toISOString(),
        level,
        message,
        ...dropUndefined(bound),
        ...dropUndefined(fields ?? {}),
    };

    // stderr keeps stdout free for a future stdio transport.
    process.stderr.write(`${JSON.stringify(line)}\n`);
}

function createLogger(bound: LogFields): Logger {
    return {
        debug: (message, fields) => write('debug', bound, message, fields),
        info: (message, fields) => write('info', bound, message, fields),
        warn: (message, fields) => write('warn', bound, message, fields),
        error: (message, fields) => write('error', bound, message, fields),
        child: fields => createLogger({ ...bound, ...fields }),
    };
}

export const logger = createLogger({});

/** Flattens an unknown thrown value into something safe to serialise. */
export function describeError(error: unknown): LogFields {
    if (error instanceof Error) {
        return { errorName: error.name, errorMessage: error.message, stack: error.stack };
    }

    return { errorMessage: String(error) };
}
