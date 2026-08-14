import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * Stage 2 widget: a deliberately plain harness for the generation orchestration
 * spike. It exists to run the two variants side by side and watch the cycle
 * complete — the real Steward interface arrives in stage 4.
 */

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 150_000;
const CONNECT_TIMEOUT_MS = 15_000;

type Variant = 'ui-tool-call' | 'conversation';
type Status = 'connecting' | 'connected' | 'generating' | 'ready' | 'failed' | 'error';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = el('status');
const draftEl = el('draft');
const metaEl = el('meta');
const generateButton = el<HTMLButtonElement>('generate');
const resetButton = el<HTMLButtonElement>('reset');
const pingButton = el<HTMLButtonElement>('ping');

const fields = {
    documentType: el<HTMLInputElement>('documentType'),
    funder: el<HTMLInputElement>('funder'),
    userRequest: el<HTMLTextAreaElement>('userRequest'),
    wordLimit: el<HTMLInputElement>('wordLimit'),
    variant: el<HTMLSelectElement>('variant'),
};

// Registered before anything else can throw, so a broken bundle reports itself
// in the panel instead of leaving the widget looking like inert HTML.
window.addEventListener('error', event => {
    setStatus('error', 'Script error');
    setMeta(event.message);
});

window.addEventListener('unhandledrejection', event => {
    setStatus('error', 'Script error');
    setMeta(String(event.reason));
});

const app = new App({ name: 'steward-app', version: '0.0.0' }, {});

let sessionId: string | null = null;
let pollTimer: number | undefined;

function setStatus(state: Status, label: string): void {
    statusEl.dataset['state'] = state;
    statusEl.textContent = label;
}

function setMeta(text: string): void {
    metaEl.textContent = text;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readInputs() {
    return {
        documentType: fields.documentType.value.trim(),
        funder: fields.funder.value.trim(),
        userRequest: fields.userRequest.value.trim(),
        wordLimit: Number(fields.wordLimit.value),
    };
}

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await app.callServerTool({ name, arguments: args });

    if (result.isError) {
        const first = result.content?.[0];
        throw new Error(first && first.type === 'text' ? first.text : `${name} failed`);
    }

    return result.structuredContent as T;
}

async function ensureSession(inputs: ReturnType<typeof readInputs>): Promise<string> {
    if (sessionId) {
        return sessionId;
    }

    const created = await callTool<{ sessionId: string }>('create_session', inputs);
    sessionId = created.sessionId;
    return sessionId;
}

function stopPolling(): void {
    if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
    }
}

/**
 * `render_draft` is called by the model against the server, so the widget is
 * never told directly that a draft landed — it watches the session instead.
 */
function pollSession(id: string, startedAt: number): void {
    stopPolling();

    pollTimer = window.setInterval(() => {
        void (async () => {
            try {
                const state = await callTool<{
                    status: string;
                    versionCount: number;
                    latestDraft: string | null;
                    failureReason?: string;
                }>('get_session', { sessionId: id });

                if (state.status === 'ready' && state.latestDraft) {
                    stopPolling();
                    draftEl.textContent = state.latestDraft;
                    setStatus('ready', 'Draft ready');
                    setMeta(
                        `v${state.versionCount} · ${Math.round((Date.now() - startedAt) / 1000)}s · session ${id.slice(0, 8)}`,
                    );
                    generateButton.disabled = false;
                    return;
                }

                if (state.status === 'failed') {
                    stopPolling();
                    setStatus('failed', state.failureReason ?? 'Generation failed');
                    setMeta('The model never called render_draft.');
                    generateButton.disabled = false;
                    return;
                }

                setMeta(`waiting for render_draft · ${Math.round((Date.now() - startedAt) / 1000)}s`);

                if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    stopPolling();
                    setStatus('failed', 'Timed out');
                    generateButton.disabled = false;
                }
            } catch (error) {
                stopPolling();
                setStatus('error', 'Polling failed');
                setMeta(describeError(error));
                generateButton.disabled = false;
            }
        })();
    }, POLL_INTERVAL_MS);
}

async function generate(): Promise<void> {
    const inputs = readInputs();

    if (!inputs.documentType || !inputs.funder || !inputs.userRequest) {
        setStatus('error', 'Fill in the fields');
        setMeta('Document type, funder and request are all required.');
        return;
    }

    const variant = fields.variant.value as Variant;
    generateButton.disabled = true;
    setStatus('generating', 'Generating…');
    setMeta('');

    try {
        const id = await ensureSession(inputs);
        const startedAt = Date.now();

        if (variant === 'ui-tool-call') {
            // Variant A: the widget asks for the brief itself, and the model has
            // to notice the tool result and carry on unprompted.
            await callTool('request_generation', { sessionId: id, ...inputs, variant });
        } else {
            // Variant B: hand the work back to the conversation and let the model
            // drive the whole cycle, which is the path hosts are tuned for.
            await app.sendMessage({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: [
                            'Steward request — please handle this now.',
                            `sessionId: ${id}`,
                            `Document type: ${inputs.documentType}`,
                            `Funder: ${inputs.funder}`,
                            `Word limit: ${inputs.wordLimit}`,
                            `Request: ${inputs.userRequest}`,
                            '',
                            'Call request_generation with that sessionId, write the document,',
                            'then call render_draft with the full text.',
                        ].join('\n'),
                    },
                ],
            });
        }

        pollSession(id, startedAt);
    } catch (error) {
        setStatus('error', 'Generation failed to start');
        setMeta(describeError(error));
        generateButton.disabled = false;
    }
}

generateButton.addEventListener('click', () => void generate());

resetButton.addEventListener('click', () => {
    stopPolling();
    sessionId = null;
    draftEl.textContent = 'No draft yet.';
    setMeta('New session will be created on the next generate.');
    setStatus('connected', 'Connected');
    generateButton.disabled = false;
});

pingButton.addEventListener('click', () => {
    void (async () => {
        try {
            const pong = await callTool<{ message: string }>('ping', {});
            setMeta(`ping → ${pong.message}`);
        } catch (error) {
            setMeta(`ping failed: ${describeError(error)}`);
        }
    })();
});

try {
    // Raced against a deadline: `ui/initialize` inherits a long protocol
    // timeout, and a silent multi-minute wait is indistinguishable from a dead
    // widget. A visible failure is worth more than a patient one.
    await Promise.race([
        app.connect(new PostMessageTransport(window.parent, window.parent)),
        new Promise((_resolve, reject) => {
            window.setTimeout(() => reject(new Error('Host did not answer ui/initialize')), CONNECT_TIMEOUT_MS);
        }),
    ]);

    const host = app.getHostVersion();
    setStatus('connected', 'Connected');
    setMeta(host ? `host: ${host.name} ${host.version}` : 'host: unknown');
    generateButton.disabled = false;
    resetButton.disabled = false;
    pingButton.disabled = false;
} catch (error) {
    setStatus('error', 'Connection failed');
    setMeta(describeError(error));
}
