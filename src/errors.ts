/**
 * Error codes surfaced to MCP clients. Stage 6 formalises the full error model;
 * this is the subset the generation cycle needs.
 */
export type StewardErrorCode =
    | 'SESSION_NOT_FOUND'
    | 'VERSION_NOT_FOUND'
    | 'DOCUMENT_TYPE_NOT_FOUND'
    | 'FUNDER_NOT_FOUND'
    | 'DEAL_NOT_FOUND'
    | 'MISSING_GENERATION_INPUT'
    | 'INVALID_WORD_LIMIT'
    | 'GENERATION_TIMEOUT'
    | 'NO_FALLBACK_AVAILABLE';

export class StewardError extends Error {
    readonly code: StewardErrorCode;
    readonly retryable: boolean;

    constructor(code: StewardErrorCode, message: string, retryable = false) {
        super(message);
        this.name = 'StewardError';
        this.code = code;
        this.retryable = retryable;
    }
}
