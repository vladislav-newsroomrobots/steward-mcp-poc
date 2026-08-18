import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * The sessions widget: what has been drafted in this workspace so far.
 *
 * Bound to `list_sessions` through `_meta.ui.resourceUri`. Unlike the draft
 * widget it needs no arguments, so it asks the server itself on connect and on
 * every Refresh — the tool result that opened it may already be stale by the
 * time someone reads it.
 */

const CONNECT_TIMEOUT_MS = 15_000;

type Status = 'connecting' | 'ready' | 'error';

interface SessionRow {
    sessionId: string;
    status: string;
    documentType?: string;
    funders: string[];
    opportunities: string[];
    versionCount: number;
    latestDraftPreview?: string;
    updatedAt: string;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = el('status');
const listEl = el('sessions');
const metaEl = el('meta');
const refreshButton = el<HTMLButtonElement>('refresh');

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

window.addEventListener('error', event => {
    setStatus('error', 'Script error');
    setMeta(event.message);
});

window.addEventListener('unhandledrejection', event => {
    setStatus('error', 'Script error');
    setMeta(String(event.reason));
});

const app = new App({ name: 'steward-sessions', version: '0.0.0' }, {});

/** `funders` and `opportunities` read better joined than as two counts. */
function describeTargets(session: SessionRow): string {
    const parts = [...session.funders, ...session.opportunities];
    return parts.length > 0 ? parts.join(' · ') : 'no funder or opportunity chosen';
}

function render(sessions: SessionRow[]): void {
    listEl.replaceChildren(
        ...sessions.map(session => {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.dataset['state'] = session.status;
            badge.textContent = session.status;

            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = session.documentType ?? 'No document type';

            const versions = document.createElement('span');
            versions.className = 'preview';
            versions.textContent =
                session.versionCount === 1 ? '1 version' : `${session.versionCount} versions`;

            const head = document.createElement('div');
            head.className = 'head';
            head.append(title, versions, badge);

            const targets = document.createElement('div');
            targets.className = 'preview';
            targets.textContent = describeTargets(session);

            const row = document.createElement('li');
            row.append(head, targets);

            if (session.latestDraftPreview !== undefined) {
                const preview = document.createElement('div');
                preview.className = 'preview';
                preview.textContent = session.latestDraftPreview;
                row.append(preview);
            }

            return row;
        }),
    );

    setStatus('ready', sessions.length === 1 ? '1 session' : `${sessions.length} sessions`);
    setMeta(sessions.length === 0 ? 'Nothing drafted yet in this workspace.' : '');
}

async function load(): Promise<void> {
    refreshButton.disabled = true;

    try {
        const result = await app.callServerTool({ name: 'list_sessions', arguments: {} });

        if (result.isError) {
            const first = result.content?.[0];
            throw new Error(first && first.type === 'text' ? first.text : 'list_sessions failed');
        }

        render((result.structuredContent as { sessions: SessionRow[] }).sessions);
    } catch (error) {
        setStatus('error', 'Could not load sessions');
        setMeta(describeError(error));
    } finally {
        refreshButton.disabled = false;
    }
}

refreshButton.addEventListener('click', () => void load());

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

    await load();
} catch (error) {
    setStatus('error', 'Connection failed');
    setMeta(describeError(error));
}
