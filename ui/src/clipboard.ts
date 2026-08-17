/**
 * Scenario E5 — a copy that is ready to paste into Gmail.
 *
 * Both flavours go on the clipboard: `text/html` so blockquotes and lists survive
 * the paste into an email client, and `text/plain` for everything else. A draft
 * that pastes as one flat paragraph is a draft the user has to reformat by hand.
 *
 * Two paths, because the widget lives in a sandboxed iframe: the async Clipboard
 * API where it is permitted, and the `copy`-event trick where it is not — which
 * is the case in more hosts than not.
 */
export async function copyRichText(html: string, text: string): Promise<void> {
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write !== undefined) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([text], { type: 'text/plain' }),
                }),
            ]);
            return;
        } catch {
            // Permissions policy or a non-secure context — fall through.
        }
    }

    await copyViaCarrier(text, html);
}

/** For an id or a handle, where a rich flavour would only get in the way. */
export async function copyPlainText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText !== undefined) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Same fallback as above.
        }
    }

    await copyViaCarrier(text);
}

async function copyViaCarrier(text: string, html?: string): Promise<void> {
    const listener = (event: ClipboardEvent): void => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', text);

        if (html !== undefined) {
            event.clipboardData?.setData('text/html', html);
        }
    };

    document.addEventListener('copy', listener);

    try {
        // Needs a non-empty selection to fire at all; the draft body provides one
        // only while it is focused, so copy from a detached node instead.
        const carrier = document.createElement('div');
        carrier.setAttribute('style', 'position:fixed;left:-9999px;top:0;white-space:pre;');
        carrier.textContent = text;
        document.body.appendChild(carrier);

        const range = document.createRange();
        range.selectNodeContents(carrier);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const copied = document.execCommand('copy');
        selection?.removeAllRanges();
        carrier.remove();

        if (!copied) {
            throw new Error('The host blocked the clipboard');
        }
    } finally {
        document.removeEventListener('copy', listener);
    }
}
