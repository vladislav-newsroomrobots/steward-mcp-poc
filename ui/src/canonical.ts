/**
 * Client side of Steward's canonical draft format.
 *
 * `contenteditable` is generous about what it produces: a paste from Word brings
 * spans, fonts and colours, and `execCommand` leaves `<b>`/`<i>` behind. This
 * narrows whatever the DOM holds back down to the format the server accepts, so
 * a saved edit round-trips instead of being silently rewritten server-side.
 *
 * The server has its own sanitizer for anything arriving over MCP
 * (`src/generation/canonical-html.ts`); the two allowlists are the same subset.
 */

const ALLOWED = new Set(['P', 'BR', 'OL', 'UL', 'LI', 'BLOCKQUOTE', 'H2', 'H3', 'STRONG', 'EM', 'U', 'S', 'A']);

const RENAMED: Record<string, string> = {
    B: 'strong',
    I: 'em',
    STRIKE: 's',
    DEL: 's',
    INS: 'u',
    DIV: 'p',
    H1: 'h2',
    H4: 'h3',
    H5: 'h3',
    H6: 'h3',
};

const SAFE_STYLE = /^(?:text-align:\s*(?:left|center|right)|margin-left:\s*\d{1,3}px)\s*;?\s*$/i;
const SAFE_HREF = /^(?:https?:|mailto:)/i;

function rename(element: Element, tag: string): Element {
    const replacement = element.ownerDocument.createElement(tag);
    while (element.firstChild) {
        replacement.appendChild(element.firstChild);
    }
    element.replaceWith(replacement);
    return replacement;
}

function clean(node: ParentNode): void {
    for (const element of [...node.children]) {
        clean(element);

        const renamed = RENAMED[element.tagName];
        const current = renamed === undefined ? element : rename(element, renamed);

        if (!ALLOWED.has(current.tagName)) {
            // Unwrap rather than delete: the words inside are the draft.
            current.replaceWith(...current.childNodes);
            continue;
        }

        for (const attribute of [...current.attributes]) {
            const keep =
                (attribute.name === 'href' &&
                    current.tagName === 'A' &&
                    SAFE_HREF.test(attribute.value.trim())) ||
                (attribute.name === 'style' && SAFE_STYLE.test(attribute.value));

            if (!keep) {
                current.removeAttribute(attribute.name);
            }
        }

        if (current.tagName === 'A') {
            current.setAttribute('rel', 'noopener noreferrer');
        }
    }
}

export function sanitizeCanonical(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style').forEach(element => element.remove());
    clean(doc.body);

    // Text left at the top level would render without paragraph spacing.
    for (const node of [...doc.body.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') {
            const p = doc.createElement('p');
            p.textContent = node.textContent;
            node.replaceWith(p);
        }
    }

    return doc.body.innerHTML.trim();
}

/** The plain clipboard flavour, and what the word count is measured on. */
export function canonicalToText(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    return [...doc.body.children]
        .map(block => (block.textContent ?? '').trim())
        .filter(text => text !== '')
        .join('\n\n')
        .trim();
}

export function wordCount(html: string): number {
    const text = canonicalToText(html);
    return text === '' ? 0 : text.split(/\s+/).length;
}
