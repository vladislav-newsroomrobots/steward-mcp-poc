import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * The draft widget: one document, shown as the model wrote it.
 *
 * Bound to `render_draft` through `_meta.ui.resourceUri`, so the host opens it
 * with the tool call rather than the user opening it. It reads the draft from
 * the call itself — the text is already in the arguments, so the common path
 * needs no round trip to the server.
 */

const CONNECT_TIMEOUT_MS = 15_000;

type Status = 'connecting' | 'ready' | 'error';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = el('status');
const draftEl = el('draft');
const metaEl = el('meta');

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

/** The text block of a tool result, which is where a failure explains itself. */
function firstText(content: Array<{ type: string; text?: string }> | undefined): string | undefined {
    const first = content?.[0];
    return first?.type === 'text' ? first.text : undefined;
}

window.addEventListener('error', event => {
    setStatus('error', 'Script error');
    setMeta(event.message);
});

window.addEventListener('unhandledrejection', event => {
    setStatus('error', 'Script error');
    setMeta(String(event.reason));
});

const app = new App({ name: 'steward-draft', version: '0.0.0' }, {});

let shown = false;
let sessionId: string | undefined;

function showDraft(text: string): void {
    draftEl.textContent = text;
    setStatus('ready', 'Draft');
    shown = true;
}

function describeVersion(versionCount: number): string {
    const version = versionCount > 0 ? `v${versionCount}` : 'v1';
    const words = draftEl.textContent?.trim().split(/\s+/).length ?? 0;
    return `${version} · ${words} words${sessionId ? ` · session ${sessionId.slice(0, 8)}` : ''}`;
}

// Both handlers are registered before `connect`: the host sends the tool input
// as soon as the handshake finishes, and a listener attached afterwards races
// it for the one notification that carries the document.
app.ontoolinput = params => {
    const args = params.arguments as { sessionId?: string; text?: string } | undefined;

    if (typeof args?.sessionId === 'string') {
        sessionId = args.sessionId;
    }

    if (typeof args?.text === 'string' && args.text.trim() !== '') {
        showDraft(args.text);
    }
};

app.ontoolresult = params => {
    // A tool that throws comes back as a result with `isError`, not as a
    // rejection. Unchecked, the panel would keep the text the arguments already
    // painted and label it a stored version that does not exist.
    if (params.isError === true) {
        setStatus('error', 'The draft was not stored');
        setMeta(firstText(params.content) ?? 'render_draft failed.');
        return;
    }

    const result = params.structuredContent as
        | { sessionId?: string; versionCount?: number }
        | undefined;

    if (typeof result?.sessionId === 'string') {
        sessionId = result.sessionId;
    }

    // A host that delivers only the result still has to show a draft, so the
    // stored version is fetched rather than assumed lost.
    if (!shown && sessionId !== undefined) {
        void (async () => {
            try {
                const state = await app.callServerTool({
                    name: 'get_session',
                    arguments: { sessionId },
                });

                // `callServerTool` resolves on a tool error too, so the flag has
                // to be read or the panel sits on "Waiting" for a call that
                // already failed.
                if (state.isError) {
                    throw new Error(firstText(state.content) ?? 'get_session failed');
                }

                const latest = (state.structuredContent as { latestDraft?: string } | undefined)
                    ?.latestDraft;

                if (typeof latest === 'string' && latest !== '') {
                    showDraft(latest);
                    setMeta(describeVersion(result?.versionCount ?? 0));
                    return;
                }

                setStatus('error', 'No draft to show');
                setMeta(`Session ${sessionId?.slice(0, 8)} has no stored version.`);
            } catch (error) {
                setStatus('error', 'Could not load the draft');
                setMeta(describeError(error));
            }
        })();
        return;
    }

    // Only once there is a document on screen: the word count is read off it,
    // and counting the placeholder would report a draft that is not there.
    if (shown) {
        setMeta(describeVersion(result?.versionCount ?? 0));
    }
};

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

    if (!shown) {
        setStatus('connecting', 'Waiting');
        setMeta('The draft arrives with the render_draft call.');
    }
} catch (error) {
    setStatus('error', 'Connection failed');
    setMeta(describeError(error));
}
