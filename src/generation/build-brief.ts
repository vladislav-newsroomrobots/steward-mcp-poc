import type { Deal, DocumentType, Funder, GenerationBrief } from '../types/index.js';

interface BuildInput {
    documentType: DocumentType;
    funder: Funder;
    deal?: Deal;
    userRequest: string;
    wordLimit: number;
    existingDraft?: string;
}

/**
 * Curated projections of the CRM payload.
 *
 * `raw` carries every column of the export, most of it irrelevant to writing a
 * letter — source system, Airtable view names, record ids. Passing it wholesale
 * would bury the few facts that change the prose in noise the model has to
 * ignore, so each field here is one a fundraiser would actually reach for.
 */
const FUNDER_FIELDS = [
    'funderType',
    'funderCapacity',
    'location',
    'primaryContactName',
    'primaryContactTitle',
    'firstGiftDate',
    'lastGiftDate',
    'lastGiftAmount',
    'largestGiftAmount',
    'totalGiftAmountAllTime',
    'totalGiftsCountAllTime',
    'currentYearGiving',
    'notes',
] as const;

const DEAL_FIELDS = [
    'dealType',
    'stage',
    'amount',
    'requestedAmount',
    'pipelineOrCampaign',
    'closeDate',
    'grantPeriodStart',
    'grantPeriodEnd',
    'nextStep',
    'description',
] as const;

function project(raw: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(
        fields.filter(field => raw[field] !== undefined && raw[field] !== '').map(field => [field, raw[field]]),
    );
}

/**
 * Turns session inputs into the package the host model writes from.
 *
 * Deliberately separate from the tool handler: this is where the backend `llm`
 * module's prompt logic lands in phase 2, and where a server-side generator
 * would read from if the host-generation gate fails. Everything upstream and
 * downstream stays the same either way.
 */
export function buildGenerationBrief({
    documentType,
    funder,
    deal,
    userRequest,
    wordLimit,
    existingDraft,
}: BuildInput): GenerationBrief {
    return {
        documentType: documentType.name,
        funder: funder.name,
        // The document type's own prompt, authored by the fundraising team —
        // not something this function should paraphrase or wrap.
        instructions: documentType.systemInstructions,
        context: {
            funder: { name: funder.name, ...project(funder.raw, FUNDER_FIELDS) },
            ...(deal === undefined
                ? {}
                : { opportunity: { title: deal.title, ...project(deal.raw, DEAL_FIELDS) } }),
        },
        constraints: {
            wordLimit,
            ...(existingDraft === undefined
                ? {}
                : { revision: 'Revise the existing draft below rather than starting over.' }),
        },
        userRequest,
        ...(existingDraft === undefined ? {} : { existingDraft }),
    };
}
