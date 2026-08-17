/**
 * Steward's canonical draft format.
 *
 * Drafts are rich text, not plain text: the extension's viewer renders
 * paragraphs, lists and pull quotes, and a copy has to survive a paste into
 * Gmail. The format is a deliberately small subset of HTML — everything the
 * fundraising copy needs and nothing that can style, script or phone home.
 *
 * Two callers sanitize: the widget (which has a real DOM) before rendering or
 * saving an edit, and this module for anything arriving over MCP. A model can
 * be asked for the subset but not trusted to stay inside it, and the panel is
 * an iframe rendering whatever the server stored.
 */

/**
 * How the format is described to the model — in the brief it writes from and in
 * the `render_draft` schema it writes into.
 */
export const CANONICAL_FORMAT_HINT =
    "Steward's canonical rich text: <p>, <h2>, <h3>, <ul>/<ol> with <li>, <blockquote>, <strong>, <em>, <u>, <s>, <a href>. No other tags, no attributes, no inline styles. Plain text is accepted and wrapped in paragraphs.";

/** Block and inline tags a draft may use. */
const ALLOWED = new Set(['p', 'br', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'strong', 'em', 'u', 's', 'a']);

/** Tags whose *content* is dropped along with them rather than unwrapped. */
const STRIPPED = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed']);

/** Presentational synonyms the model or a paste may produce. */
const RENAMED: Record<string, string> = {
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    ins: 'u',
    div: 'p',
    section: 'p',
    article: 'p',
    h1: 'h2',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
};

const VOID = new Set(['br']);
const BLOCKS = new Set(['p', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3']);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** Only `text-align` and a plain `margin-left` indent survive — see the toolbar. */
const SAFE_STYLE = /^(?:text-align:\s*(?:left|center|right)|margin-left:\s*\d{1,3}px)\s*;?\s*$/i;
const SAFE_HREF = /^(?:https?:|mailto:)/i;

/** Escapes text, leaving existing entities (`&amp;`, `&#8217;`) intact. */
function escapeText(text: string): string {
    return text.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,9};|#\d{1,6};|#x[0-9a-fA-F]{1,6};)/g, '&amp;').replace(/</g, '&lt;');
}

function keptAttributes(tag: string, raw: string): string {
    let kept = '';

    for (const match of raw.matchAll(ATTR)) {
        const name = match[1]!.toLowerCase();
        const value = match[3] ?? match[4] ?? match[5] ?? '';

        if (name === 'href' && tag === 'a' && SAFE_HREF.test(value.trim())) {
            // Links in a draft point at a funder's site or a mailto — they open
            // outside the panel, so they get the usual hardening.
            kept += ` href="${escapeText(value.trim()).replace(/"/g, '&quot;')}" rel="noopener noreferrer"`;
        } else if (name === 'style' && SAFE_STYLE.test(value)) {
            kept += ` style="${value.trim().replace(/"/g, '')}"`;
        }
    }

    return kept;
}

/** Wraps plain text: blank lines separate paragraphs, single newlines break. */
function fromPlainText(text: string): string {
    return text
        .split(/\n\s*\n/)
        .map(block => block.trim())
        .filter(block => block !== '')
        .map(block => `<p>${escapeText(block).replace(/\n/g, '<br />')}</p>`)
        .join('');
}

/**
 * Normalises a draft into the canonical subset.
 *
 * Plain text is accepted and wrapped — the fixture drafts are plain, and a model
 * that ignores the format instruction should still produce a readable draft
 * rather than an error the user has to understand.
 */
export function toCanonicalHtml(input: string): string {
    const source = input.trim();

    if (source === '') {
        return '';
    }

    if (!TAG.test(source)) {
        TAG.lastIndex = 0;
        return fromPlainText(source);
    }

    TAG.lastIndex = 0;

    const open: string[] = [];
    let out = '';
    let cursor = 0;
    /** Set while skipping the contents of a stripped element. */
    let skipping: string | null = null;

    const emitText = (text: string): void => {
        if (skipping !== null || text === '') {
            return;
        }

        // Text outside any block would render as a bare node; the viewer's
        // spacing comes from paragraphs, so give it one.
        if (!open.some(tag => BLOCKS.has(tag))) {
            if (text.trim() === '') {
                return;
            }
            out += `<p>${escapeText(text.trim())}</p>`;
            return;
        }

        out += escapeText(text);
    };

    for (const match of source.matchAll(TAG)) {
        const at = match.index ?? cursor;
        emitText(source.slice(cursor, at));
        cursor = at + match[0].length;

        const closing = match[1] === '/';
        const raw = match[2]!.toLowerCase();
        const tag = RENAMED[raw] ?? raw;

        if (skipping !== null) {
            if (closing && raw === skipping) {
                skipping = null;
            }
            continue;
        }

        if (STRIPPED.has(raw)) {
            if (!closing) {
                skipping = raw;
            }
            continue;
        }

        if (!ALLOWED.has(tag)) {
            // Unknown wrapper: drop the tag, keep what it wrapped.
            continue;
        }

        if (VOID.has(tag)) {
            if (!closing && open.some(t => BLOCKS.has(t))) {
                out += '<br />';
            }
            continue;
        }

        if (closing) {
            const depth = open.lastIndexOf(tag);
            if (depth === -1) {
                continue;
            }
            // Close anything left open inside it, so the output is well formed
            // even when the input was not.
            for (let i = open.length - 1; i >= depth; i -= 1) {
                out += `</${open[i]}>`;
            }
            open.length = depth;
            continue;
        }

        out += `<${tag}${keptAttributes(tag, match[3] ?? '')}>`;
        open.push(tag);
    }

    emitText(source.slice(cursor));

    for (let i = open.length - 1; i >= 0; i -= 1) {
        out += `</${open[i]}>`;
    }

    return tidy(out);
}

/** `<div><span> </span></div>` unwraps to an empty paragraph, not to a draft. */
const EMPTY_BLOCK = /<(p|h2|h3|blockquote|li|ul|ol)>(?:\s|<br\s*\/?>)*<\/\1>/gi;

function tidy(html: string): string {
    let result = html.trim();

    for (let previous = ''; previous !== result; ) {
        previous = result;
        result = result.replace(EMPTY_BLOCK, '').trim();
    }

    // Markup with no words in it is not a document, and storing it as a version
    // would put an empty draft in the panel and in the next brief.
    return canonicalToText(result) === '' ? '' : result;
}

/** Plain-text projection, for word counts and the plain clipboard flavour. */
export function canonicalToText(html: string): string {
    return html
        .replace(/<(?:br|\/p|\/li|\/blockquote|\/h2|\/h3)\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function wordCount(html: string): number {
    const text = canonicalToText(html);
    return text === '' ? 0 : text.split(/\s+/).length;
}
