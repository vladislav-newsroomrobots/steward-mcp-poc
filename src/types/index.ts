/** Who produced a draft version. */
export type DraftSource = 'gpt' | 'user' | 'fallback';

export interface DraftVersion {
    id: string;
    source: DraftSource;
    text: string;
    createdAt: string;
}

export type SessionStatus = 'idle' | 'generating' | 'ready' | 'failed';

/** What the user asked for. Fixtures replace the free-text fields in stage 3. */
export interface SessionInputs {
    documentType: string;
    funder: string;
    userRequest: string;
    wordLimit: number;
}

export interface Session {
    id: string;
    status: SessionStatus;
    inputs: Partial<SessionInputs>;
    versions: DraftVersion[];
    createdAt: string;
    updatedAt: string;
    /** Set while status is `generating`; drives the lazy timeout check. */
    generationStartedAt?: string;
    failureReason?: string;
}

/** The package handed to the host model, which does the actual writing. */
export interface GenerationBrief {
    documentType: string;
    funder: string;
    instructions: string;
    userRequest: string;
    wordLimit: number;
    /** Present when refining rather than writing from scratch. */
    existingDraft?: string;
}

/**
 * Which orchestration pattern triggered an attempt.
 *
 * - `ui-tool-call` — the widget called `request_generation` itself (variant A)
 * - `conversation` — the widget asked the host to continue the conversation and
 *   the model called `request_generation` (variant B)
 */
export type OrchestrationVariant = 'ui-tool-call' | 'conversation';

export type RunResult = 'pending' | 'rendered' | 'timeout';

/** One `request_generation → render_draft` attempt, for the stage 2 metrics. */
export interface GenerationRun {
    runId: string;
    sessionId: string;
    variant: OrchestrationVariant;
    documentType: string;
    wordLimit: number;
    isRefinement: boolean;
    startedAt: string;
    requestGenerationCalled: boolean;
    renderDraftCalled: boolean;
    result: RunResult;
    durationMs?: number;
    failureReason?: string;
}
