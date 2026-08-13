import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * Stage 1 widget: prove the host → tunnel → server → tool chain end to end.
 * The real Steward interface replaces this in stage 4.
 */

const statusEl = document.getElementById('status') as HTMLElement;
const hostInfoEl = document.getElementById('host-info') as HTMLElement;
const pingButton = document.getElementById('ping') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLElement;

function setStatus(state: 'connecting' | 'ready' | 'error', label: string): void {
    statusEl.dataset['state'] = state;
    statusEl.textContent = label;
}

function setOutput(value: unknown): void {
    outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function renderHostInfo(rows: Array<[string, string]>): void {
    hostInfoEl.replaceChildren(
        ...rows.flatMap(([label, value]) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            return [dt, dd];
        }),
    );
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const app = new App({ name: 'steward-app', version: '0.0.0' }, {});

pingButton.addEventListener('click', () => {
    void (async () => {
        pingButton.disabled = true;
        setOutput('Calling ping…');

        try {
            const result = await app.callServerTool({ name: 'ping', arguments: {} });
            setOutput(result.structuredContent ?? result.content);
        } catch (error) {
            setOutput(`ping failed: ${describeError(error)}`);
        } finally {
            pingButton.disabled = false;
        }
    })();
});

try {
    await app.connect(new PostMessageTransport(window.parent, window.parent));

    const host = app.getHostVersion();
    const context = app.getHostContext();

    setStatus('ready', 'Connected successfully');
    renderHostInfo([
        ['Host', host ? `${host.name} ${host.version}` : 'unknown'],
        ['Theme', context?.theme ?? 'unspecified'],
        ['Locale', context?.locale ?? 'unspecified'],
    ]);
    pingButton.disabled = false;
} catch (error) {
    setStatus('error', 'Connection failed');
    setOutput(describeError(error));
}
