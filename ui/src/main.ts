import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * Stage 2 widget: a deliberately plain harness for the generation orchestration
 * spike — the real Steward interface arrives in stage 4.
 *
 * It never shows a draft: this panel gathers context and hands over the request,
 * and the finished document opens in the draft panel via `render_draft`.
 *
 * There is no way to start a session from here either. The host re-renders the
 * panel on every `open_steward`, so a fresh one already means a fresh session;
 * within one panel the session persists, which is what refinement needs.
 */

const CONNECT_TIMEOUT_MS = 15_000;

type Status = 'connecting' | 'connected' | 'briefed' | 'error';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = el('status');
const metaEl = el('meta');
const generateButton = el<HTMLButtonElement>('generate');

const tipsEl = el('tips');

const fields = {
    documentType: el<HTMLSelectElement>('documentType'),
    userRequest: el<HTMLTextAreaElement>('userRequest'),
    wordLimit: el<HTMLInputElement>('wordLimit'),
};

interface DocumentTypeOption {
    id: string;
    name: string;
    tips: string[];
}

/**
 * One side of the funder ↔ opportunity pair.
 *
 * The two behave identically — a picker that adds, chips that remove, and a hop
 * to the other side on every add — so they are one structure used twice rather
 * than two near-copies of the same handlers.
 */
interface Picker {
    picker: HTMLSelectElement;
    chips: HTMLElement;
    /** Everything selectable, id → label, in workspace order. */
    catalog: Map<string, string>;
    /** What is currently chosen, id → label. */
    chosen: Map<string, string>;
    addLabel: string;
    /** Called with a newly added id, to pull in what it links to. */
    onAdd(id: string): Promise<void>;
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

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await app.callServerTool({ name, arguments: args });

    if (result.isError) {
        const first = result.content?.[0];
        throw new Error(first && first.type === 'text' ? first.text : `${name} failed`);
    }

    return result.structuredContent as T;
}

const funders: Picker = {
    picker: el<HTMLSelectElement>('funderPicker'),
    chips: el('funderChips'),
    catalog: new Map(),
    chosen: new Map(),
    addLabel: 'Add a funder…',
    onAdd: async id => {
        const { opportunities } = await callTool<{ opportunities: Array<{ id: string; title: string }> }>(
            'get_linked_objects',
            { funderIds: [id] },
        );

        adopt(deals, opportunities.map(o => ({ id: o.id, label: o.title })));
    },
};

const deals: Picker = {
    picker: el<HTMLSelectElement>('dealPicker'),
    chips: el('dealChips'),
    catalog: new Map(),
    chosen: new Map(),
    addLabel: 'Add an opportunity…',
    onAdd: async id => {
        const { funders: linked } = await callTool<{ funders: Array<{ id: string; name: string }> }>(
            'get_linked_objects',
            { dealIds: [id] },
        );

        adopt(funders, linked.map(f => ({ id: f.id, label: f.name })));
    },
};

/**
 * Takes in rows the other side pulled.
 *
 * Labels come from the catalog when it has them, so a chip pulled in by a link
 * reads exactly like one picked by hand. Nothing is ever removed here — what
 * the user took off stays off.
 */
function adopt(side: Picker, rows: Array<{ id: string; label: string }>): void {
    for (const row of rows) {
        if (!side.chosen.has(row.id)) {
            side.chosen.set(row.id, side.catalog.get(row.id) ?? row.label);
        }
    }

    render(side);
}

/** Redraws a side: chips for what is chosen, picker for what is left. */
function render(side: Picker): void {
    side.chips.replaceChildren(
        ...[...side.chosen].map(([id, label]) => {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.title = `Remove ${label}`;
            remove.setAttribute('aria-label', `Remove ${label}`);
            remove.addEventListener('click', () => {
                side.chosen.delete(id);
                render(side);
            });

            const chip = document.createElement('li');
            chip.append(label, remove);
            return chip;
        }),
    );

    // Chosen rows leave the picker: offering them again would do nothing, and
    // the shrinking list is how the panel shows what is left to add.
    const available = [...side.catalog].filter(([id]) => !side.chosen.has(id));

    side.picker.replaceChildren(
        new Option(available.length > 0 ? side.addLabel : 'Nothing left to add', ''),
        ...available.map(([id, label]) => new Option(label, id)),
    );
    side.picker.value = '';
    side.picker.disabled = available.length === 0;
}

function attachPicker(side: Picker): void {
    side.picker.addEventListener('change', () => {
        const id = side.picker.value;

        if (!id) {
            return;
        }

        side.chosen.set(id, side.catalog.get(id) ?? id);
        render(side);

        void (async () => {
            try {
                // One hop, and only for the row just added: pulling for the whole
                // selection would keep resurrecting chips the user removed.
                await side.onAdd(id);
            } catch (error) {
                setMeta(`Could not load linked records: ${describeError(error)}`);
            }
        })();
    });
}

function readInputs() {
    return {
        documentTypeId: fields.documentType.value,
        funderIds: [...funders.chosen.keys()],
        dealIds: [...deals.chosen.keys()],
        userRequest: fields.userRequest.value.trim(),
        wordLimit: Number(fields.wordLimit.value),
    };
}

function fillSelect(select: HTMLSelectElement, options: Array<{ value: string; label: string }>): void {
    select.replaceChildren(...options.map(option => new Option(option.label, option.value)));
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

async function ensureSession(inputs: ReturnType<typeof readInputs>): Promise<string> {
    if (sessionId) {
        return sessionId;
    }

    const created = await callTool<{ sessionId: string }>('create_session', inputs);
    sessionId = created.sessionId;
    return sessionId;
}

async function generate(): Promise<void> {
    const inputs = readInputs();
    const hasTarget = inputs.funderIds.length > 0 || inputs.dealIds.length > 0;

    if (!inputs.documentTypeId || !hasTarget || !inputs.userRequest) {
        setStatus('error', 'Fill in the fields');
        setMeta('Document type, a request, and at least one funder or opportunity are required.');
        return;
    }

    generateButton.disabled = true;
    setStatus('connected', 'Sending brief…');
    setMeta('');

    try {
        const id = await ensureSession(inputs);

        // Variant B: hand the work back to the conversation and let the model
        // drive the whole cycle, which is the path hosts are tuned for. Variant A
        // — the widget calling request_generation itself — is still accepted by
        // the server, but the panel no longer offers it.
        await app.sendMessage({
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: [
                        'Steward request — please handle this now.',
                        `sessionId: ${id}`,
                        `documentTypeId: ${inputs.documentTypeId}`,
                        `funderIds: ${inputs.funderIds.join(', ') || 'none'}`,
                        `dealIds: ${inputs.dealIds.join(', ') || 'none'}`,
                        `Word limit: ${inputs.wordLimit}`,
                        `Request: ${inputs.userRequest}`,
                        '',
                        'Call request_generation with that sessionId, write the document,',
                        'then tell me it is ready and ask before showing it.',
                    ].join('\n'),
                },
            ],
        });

        // Nothing to wait for: the model writes the draft in the conversation and
        // offers it there, so the panel's job ends with the brief.
        setStatus('briefed', 'Brief sent');
        setMeta(`session ${id.slice(0, 8)} · the draft is offered in the chat`);
        generateButton.disabled = false;
    } catch (error) {
        setStatus('error', 'Generation failed to start');
        setMeta(describeError(error));
        generateButton.disabled = false;
    }
}

generateButton.addEventListener('click', () => void generate());

fields.documentType.addEventListener('change', () => showTips(fields.documentType.value));

attachPicker(funders);
attachPicker(deals);

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
        opportunities: Array<{ id: string; title: string; stage?: string }>;
    }>('get_workspace', {});

    documentTypes = ws.documentTypes;
    fillSelect(fields.documentType, documentTypes.map(t => ({ value: t.id, label: t.name })));

    // Both catalogues arrive filled: an opportunity can be the first thing
    // picked, so there is no funder selection to load them from.
    for (const funder of ws.funders) {
        funders.catalog.set(
            funder.id,
            funder.lastGrantAmount ? `${funder.name} · ${funder.lastGrantAmount}` : funder.name,
        );
    }

    for (const opportunity of ws.opportunities) {
        deals.catalog.set(
            opportunity.id,
            opportunity.stage ? `${opportunity.title} · ${opportunity.stage}` : opportunity.title,
        );
    }

    render(funders);
    render(deals);
    showTips(fields.documentType.value);

    generateButton.disabled = false;
} catch (error) {
    setStatus('error', 'Connection failed');
    setMeta(describeError(error));
}
