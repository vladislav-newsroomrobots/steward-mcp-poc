import { join } from 'node:path';

import { z } from 'zod';

import { PROJECT_ROOT } from './paths.js';

// Loaded from the package root rather than the working directory: bare
// `loadEnvFile()` resolves against cwd, so starting the server from anywhere
// else would silently ignore .env. A missing file is fine — every setting below
// has a usable default (see .env.example).
try {
    process.loadEnvFile(join(PROJECT_ROOT, '.env'));
} catch {
    // no .env present — fall back to real environment variables
}

const csv = z
    .string()
    .transform(value => value.split(',').map(part => part.trim()).filter(Boolean))
    .pipe(z.array(z.string()));

const configSchema = z.object({
    PORT: z.coerce.number().int().positive().max(65535).default(3003),
    HOST: z.string().min(1).default('127.0.0.1'),
    // Extra Host header values accepted by the DNS-rebinding guard. The tunnel
    // hostname goes here once stage 1 wires up the ChatGPT connection.
    ALLOWED_HOSTS: csv.default(''),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DEMO_MODE: z
        .enum(['true', 'false'])
        .default('false')
        .transform(value => value === 'true'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = Object.freeze(parsed.data);

export type Config = typeof config;
