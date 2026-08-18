import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StewardError } from '../errors.js';
import { PROJECT_ROOT } from '../paths.js';
import type {
    Deal,
    DocumentType,
    FallbackDraft,
    Funder,
    LinkedFunder,
    LinkedOpportunity,
} from '../types/index.js';

/**
 * Fixture-backed workspace data.
 *
 * Shapes follow the production contracts in the extension's `api-client.ts`
 * rather than the simplified ones in the stage plan, so phase 2 replaces the
 * loader below with real endpoints and leaves every consumer untouched.
 *
 * Loaded once at startup: fixtures are static, and a read per tool call would
 * only add failure modes.
 */
function load<T>(name: string): T {
    const path = join(PROJECT_ROOT, 'fixtures', name);

    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch (cause) {
        throw new Error(`Cannot load fixture ${name} from ${path}`, { cause });
    }
}

const documentTypes = load<DocumentType[]>('document-types.json').sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
);
const funders = load<Funder[]>('funders.json');
const deals = load<Deal[]>('deals.json');
const drafts = load<FallbackDraft[]>('drafts.json');

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
    new Map(items.map(item => [item.id, item]));

const documentTypeIndex = byId(documentTypes);
const funderIndex = byId(funders);
const dealIndex = byId(deals);

export const workspace = {
    /**
     * Everything the widget needs on load: `get_workspace`.
     *
     * Opportunities ship with it because the panel lets them be picked without
     * a funder, so there is no earlier moment to load them. Which funder each
     * one belongs to is deliberately left out — that hop stays a server call.
     */
    summary(): { documentTypes: DocumentType[]; funders: Funder[]; deals: Deal[] } {
        return { documentTypes, funders, deals };
    },

    documentType(id: string): DocumentType {
        const found = documentTypeIndex.get(id);
        if (!found) {
            throw new StewardError('DOCUMENT_TYPE_NOT_FOUND', `No document type with id ${id}`);
        }
        return found;
    },

    funder(id: string): Funder {
        const found = funderIndex.get(id);
        if (!found) {
            throw new StewardError('FUNDER_NOT_FOUND', `No funder with id ${id}`);
        }
        return found;
    },

    deal(id: string): Deal {
        const found = dealIndex.get(id);
        if (!found) {
            throw new StewardError('DEAL_NOT_FOUND', `No deal with id ${id}`);
        }
        return found;
    },

    /** One hop from funders to their deals: `get_linked_objects`. */
    linkedDeals(funderIds: string[]): LinkedOpportunity[] {
        const wanted = new Set(funderIds);
        for (const id of wanted) {
            this.funder(id);
        }

        return deals
            .filter(deal => wanted.has(deal.funderId))
            .map(deal => ({
                id: deal.id,
                title: deal.title,
                ...(deal.stage === undefined ? {} : { stage: deal.stage }),
                ...(deal.isPrimary === undefined ? {} : { isPrimary: deal.isPrimary }),
            }));
    },

    /**
     * The same hop backwards: the funders behind a set of opportunities.
     *
     * The panel needs it because opportunities can be picked on their own, and
     * a brief written without the funder behind them would be missing the giving
     * history that shapes the prose.
     */
    linkedFunders(dealIds: string[]): LinkedFunder[] {
        const funderIds = new Set(dealIds.map(id => this.deal(id).funderId));

        return [...funderIds].map(id => {
            const { name, lastGrantAmount } = this.funder(id);
            return { id, name, ...(lastGrantAmount === undefined ? {} : { lastGrantAmount }) };
        });
    },

    /**
     * Pre-written draft for the demo safety net: exact match on document type
     * and funder first, then the generic one. Returns undefined if neither
     * exists, which the caller surfaces rather than hides.
     */
    fallbackDraft(documentTypeId?: string, funderId?: string): FallbackDraft | undefined {
        return (
            drafts.find(d => d.documentTypeId === documentTypeId && d.funderId === funderId) ??
            drafts.find(d => d.documentTypeId === '*' && d.funderId === '*')
        );
    },
};
