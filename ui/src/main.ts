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

const tipsEl = el('tips');

const fields = {
    documentType: el<HTMLSelectElement>('documentType'),
    funder: el<HTMLSelectElement>('funder'),
    deal: el<HTMLSelectElement>('deal'),
    userRequest: el<HTMLTextAreaElement>('userRequest'),
    wordLimit: el<HTMLInputElement>('wordLimit'),
    variant: el<HTMLSelectElement>('variant'),
};

interface DocumentTypeOption {
    id: string;
    name: string;
    tips: string[];
}

let documentTypes: DocumentTypeOption[] = [];

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
        documentTypeId: fields.documentType.value,
        funderId: fields.funder.value,
        ...(fields.deal.value === '' ? {} : { dealId: fields.deal.value }),
        userRequest: fields.userRequest.value.trim(),
        wordLimit: Number(fields.wordLimit.value),
    };
}

function fillSelect(
    select: HTMLSelectElement,
    options: Array<{ value: string; label: string }>,
    placeholder?: string,
): void {
    select.replaceChildren(
        ...(placeholder === undefined ? [] : [new Option(placeholder, '')]),
        ...options.map(option => new Option(option.label, option.value)),
    );
}

function showTips(documentTypeId: string): void {
    const tips = documentTypes.find(type => type.id === documentTypeId)?.tips ?? [];

    tipsEl.replaceChildren(
        ...tips.map(tip => {
            const li = document.createElement('li');
            li.textContent = tip;
            return li;
        }),
    );
}

/** Opportunities belong to a funder, so they load only once one is chosen. */
async function loadDeals(funderId: string): Promise<void> {
    if (!funderId) {
        fillSelect(fields.deal, [], 'No funder selected');
        return;
    }

    const { opportunities } = await callTool<{
        opportunities: Array<{ id: string; title: string; stage?: string }>;
    }>('get_linked_objects', { funderId });

    fillSelect(
        fields.deal,
        opportunities.map(o => ({ value: o.id, label: o.stage ? `${o.title} · ${o.stage}` : o.title })),
        opportunities.length > 0 ? 'None' : 'No linked opportunities',
    );
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

    if (!inputs.documentTypeId || !inputs.funderId || !inputs.userRequest) {
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
                            `documentTypeId: ${inputs.documentTypeId}`,
                            `funderId: ${inputs.funderId}`,
                            ...(inputs.dealId === undefined ? [] : [`dealId: ${inputs.dealId}`]),
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

fields.documentType.addEventListener('change', () => showTips(fields.documentType.value));

fields.funder.addEventListener('change', () => {
    void (async () => {
        // A stale opportunity from the previous funder would silently poison
        // the brief, so clear before loading rather than after.
        fillSelect(fields.deal, [], 'Loading…');

        try {
            await loadDeals(fields.funder.value);
        } catch (error) {
            fillSelect(fields.deal, [], 'Could not load opportunities');
            setMeta(describeError(error));
        }
    })();
});

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

    const ws = await callTool<{
        documentTypes: DocumentTypeOption[];
        funders: Array<{ id: string; name: string; lastGrantAmount?: string }>;
    }>('get_workspace', {});

    documentTypes = ws.documentTypes;
    fillSelect(fields.documentType, documentTypes.map(t => ({ value: t.id, label: t.name })));
    fillSelect(
        fields.funder,
        ws.funders.map(f => ({
            value: f.id,
            label: f.lastGrantAmount ? `${f.name} · ${f.lastGrantAmount}` : f.name,
        })),
        'Select a funder',
    );
    fillSelect(fields.deal, [], 'No funder selected');
    showTips(fields.documentType.value);

    generateButton.disabled = false;
    resetButton.disabled = false;
    pingButton.disabled = false;
} catch (error) {
    setStatus('error', 'Connection failed');
    setMeta(describeError(error));
}
