import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

/**
 * A broken bundle must announce itself.
 *
 * The panel is an iframe: nothing the host shows the user distinguishes a widget
 * that threw on load from one that is still thinking, so a fatal error is painted
 * into the document itself. Registered before the first render, because that is
 * exactly when a bad bundle fails.
 */
let mounted = false;

function reportFatal(message: string): void {
    // Once React owns the document, a stray rejection is reported in the panel's
    // own error banner instead — blanking a working interface would be worse.
    if (root === null || mounted) {
        return;
    }

    root.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'banner err';
    banner.textContent = `Steward panel failed to start: ${message}`;
    root.appendChild(banner);
}

window.addEventListener('error', event => reportFatal(event.message));
window.addEventListener('unhandledrejection', event => reportFatal(String(event.reason)));

if (root === null) {
    throw new Error('index.html is missing #root');
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

mounted = true;
