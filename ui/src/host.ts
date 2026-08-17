import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * The widget's only channel to the outside world.
 *
 * It never talks to the Steward server directly: `@modelcontextprotocol/ext-apps`
 * connects to the host over `postMessage`, and the host makes the MCP calls.
 */

const CONNECT_TIMEOUT_MS = 15_000;

export const app = new App({ name: 'steward-app', version: '0.0.0' }, {});

/** A tool that answered with `isError`, with the server's error code recovered. */
export class ToolError extends Error {
    readonly tool: string;
    readonly code: string | undefined;

    constructor(tool: string, message: string) {
        // `withToolLogging` prefixes modelled failures with their code, which is
        // the difference between "already rated" and "something broke".
        const match = /^\[([A-Z_]+)]\s*(.*)$/s.exec(message);
        super(match?.[2] ?? message);
        this.name = 'ToolError';
        this.tool = tool;
        this.code = match?.[1];
    }
}

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Connects, racing a deadline: `ui/initialize` inherits a long protocol timeout,
 * and a silent multi-minute wait is indistinguishable from a dead widget. A
 * visible failure is worth more than a patient one.
 */
export async function connectHost(): Promise<string> {
    await Promise.race([
        app.connect(new PostMessageTransport(window.parent, window.parent)),
        new Promise<never>((_resolve, reject) => {
            window.setTimeout(() => reject(new Error('Host did not answer ui/initialize')), CONNECT_TIMEOUT_MS);
        }),
    ]);

    const host = app.getHostVersion();
    return host ? `${host.name} ${host.version}` : 'unknown host';
}

export async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await app.callServerTool({ name, arguments: args });

    if (result.isError) {
        const first = result.content?.[0];
        throw new ToolError(name, first && first.type === 'text' ? first.text : `${name} failed`);
    }

    return result.structuredContent as T;
}

/** Hands work back to the conversation — the widget → chat direction. */
export async function sendMessage(text: string): Promise<void> {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
}
