import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StewardError } from '../errors.js';
import { PROJECT_ROOT } from '../paths.js';
import type { Deal, DocumentType, FallbackDraft, Funder, LinkedOpportunity } from '../types/index.js';

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
    /** Everything the widget needs on load: `get_workspace`. */
    summary(): { documentTypes: DocumentType[]; funders: Funder[] } {
        return { documentTypes, funders };
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

    /** One hop from a funder to its deals: `get_linked_objects`. */
    linkedDeals(funderId: string): LinkedOpportunity[] {
        this.funder(funderId);

        return deals
            .filter(deal => deal.funderId === funderId)
            .map(deal => ({
                id: deal.id,
                title: deal.title,
                ...(deal.stage === undefined ? {} : { stage: deal.stage }),
                ...(deal.isPrimary === undefined ? {} : { isPrimary: deal.isPrimary }),
            }));
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
