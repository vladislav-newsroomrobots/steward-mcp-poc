import type { GenerationBrief, SessionInputs } from '../types/index.js';

interface BuildInput extends SessionInputs {
    existingDraft?: string;
}

/**
 * Turns session inputs into the package the host model writes from.
 *
 * Kept out of the tool handler on purpose: stage 3 feeds it fixture data and
 * per-document-type `systemInstructions`, and phase 2 may replace the body with
 * the prompt logic from the backend `llm` module. This function is that seam.
 */
export function buildGenerationBrief({
    documentType,
    funder,
    userRequest,
    wordLimit,
    existingDraft,
}: BuildInput): GenerationBrief {
    const instructions = [
        existingDraft
            ? `Revise the existing ${documentType} addressed to ${funder}.`
            : `Write a ${documentType} addressed to ${funder}.`,
        'Use the warm, specific, donor-centred voice a fundraising team would use.',
        `Keep it to roughly ${wordLimit} words.`,
        'Return the document text only — no preamble, no commentary, no markdown headings.',
    ].join(' ');

    return {
        documentType,
        funder,
        instructions,
        userRequest,
        wordLimit,
        ...(existingDraft === undefined ? {} : { existingDraft }),
    };
}
