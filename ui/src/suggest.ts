import type { DocumentTypeOption, FunderOption, OpportunityOption } from './types';

/**
 * Scenario C0 — the user names only the document, and Steward proposes who it is
 * for instead of handing them an empty form.
 *
 * The ranking is deliberately transparent and cheap: overlap between the request
 * and the record's name, how large and how recent the last grant was, and whether
 * an opportunity's stage fits the kind of request. Every suggestion shows the
 * reasons it scored on, so a wrong guess is obvious rather than mysterious.
 *
 * It runs in the widget because the widget is where the picking happens. When the
 * model needs the same ranking for a request that arrives in chat, this moves to
 * the server behind a `suggest_context` tool — the scoring is the deliverable,
 * not its location.
 */

export interface Reason {
    label: string;
    /** Reasons that actually drove the ranking, highlighted for the reader. */
    hot?: boolean;
}

export interface Suggestion<T> {
    item: T;
    score: number;
    reasons: Reason[];
}

const STOPWORDS = new Set([
    'the',
    'and',
    'for',
    'with',
    'our',
    'their',
    'write',
    'draft',
    'letter',
    'note',
    'please',
    'about',
    'that',
    'this',
    'from',
    'foundation',
    'fund',
    'trust',
]);

/** Request words that hint at the kind of document, beyond a literal name match. */
const DOCUMENT_HINTS: Record<string, readonly string[]> = {
    thank: ['thank', 'gratitude', 'grateful', 'gift', 'donation'],
    report: ['report', 'reporting', 'outcomes', 'results', 'metrics'],
    renewal: ['renew', 'renewal', 'continue', 'continuation', 'extend'],
    impact: ['impact', 'outcome', 'difference'],
    update: ['update', 'progress', 'news'],
    proposal: ['proposal', 'ask', 'request', 'loi', 'inquiry'],
};

const RENEWAL_REQUEST = /\b(renew|renewal|continu|extend|again)/i;

function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter(word => word.length > 2 && !STOPWORDS.has(word));
}

/** `"$150,000"` → `150000`. Amounts arrive as CRM strings, not numbers. */
function amount(value: string | undefined): number {
    if (value === undefined) {
        return 0;
    }

    const digits = value.replace(/[^0-9.]/g, '');
    return digits === '' ? 0 : Number.parseFloat(digits);
}

function formatAmount(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function byScore<T>(a: Suggestion<T>, b: Suggestion<T>): number {
    return b.score - a.score;
}

export function suggestDocumentTypes(request: string, types: DocumentTypeOption[]): Suggestion<DocumentTypeOption>[] {
    const words = new Set(tokens(request));
    const lower = request.toLowerCase();

    return types
        .map(item => {
            const reasons: Reason[] = [];
            let score = 0;

            const named = tokens(item.name).filter(word => words.has(word));
            if (named.length > 0) {
                score += 4 * named.length;
                reasons.push({ label: `you said "${named.join('", "')}"`, hot: true });
            }

            for (const [key, hints] of Object.entries(DOCUMENT_HINTS)) {
                if (!tokens(item.name).some(word => word.startsWith(key.slice(0, 5)))) {
                    continue;
                }
                if (hints.some(hint => lower.includes(hint))) {
                    score += 3;
                    reasons.push({ label: `reads like a ${key} request` });
                    break;
                }
            }

            return { item, score, reasons };
        })
        .filter(suggestion => suggestion.score > 0)
        .sort(byScore);
}

export function suggestFunders(request: string, funders: FunderOption[], limit = 3): Suggestion<FunderOption>[] {
    const words = new Set(tokens(request));
    const lower = request.toLowerCase();

    const scored = funders.map(item => {
        const reasons: Reason[] = [];
        let score = 0;

        if (item.name.trim() !== '' && lower.includes(item.name.toLowerCase())) {
            score += 10;
            reasons.push({ label: 'named in your request', hot: true });
        } else {
            const named = tokens(item.name).filter(word => words.has(word));
            if (named.length > 0) {
                score += 4 * named.length;
                reasons.push({ label: `matches "${named.join('", "')}"`, hot: true });
            }
        }

        const last = formatAmount(item.lastGrantAmount);
        if (last !== undefined) {
            // A tie-break, not a driver: a big past grant makes a funder likelier
            // to be the subject, but never beats being named.
            score += Math.min(amount(item.lastGrantAmount) / 100_000, 2);
            reasons.push({ label: `last grant ${last}` });
        }

        return { item, score, reasons };
    });

    const matched = scored.filter(suggestion => suggestion.reasons.some(reason => reason.hot));

    // Nothing in the request points anywhere: fall back to the funders with the
    // most at stake rather than showing an empty panel.
    const pool = matched.length > 0 ? matched : scored.filter(suggestion => suggestion.score > 0);

    return pool.sort(byScore).slice(0, limit);
}

export function suggestOpportunities(
    request: string,
    opportunities: OpportunityOption[],
    limit = 3,
): Suggestion<OpportunityOption>[] {
    const words = new Set(tokens(request));
    const wantsRenewal = RENEWAL_REQUEST.test(request);

    return opportunities
        .map(item => {
            const reasons: Reason[] = [];
            let score = 1;

            const named = tokens(item.title).filter(word => words.has(word));
            if (named.length > 0) {
                score += 4 * named.length;
                reasons.push({ label: `matches "${named.join('", "')}"`, hot: true });
            }

            if (item.stage !== undefined && item.stage.trim() !== '') {
                const renewalStage = /renew/i.test(item.stage);
                const hot = renewalStage && wantsRenewal;
                score += hot ? 3 : 0;
                reasons.push({ label: `stage: ${item.stage}`, ...(hot ? { hot: true } : {}) });
            }

            if (item.isPrimary === true) {
                score += 2;
                reasons.push({ label: 'primary' });
            }

            return { item, score, reasons };
        })
        .sort(byScore)
        .slice(0, limit);
}
