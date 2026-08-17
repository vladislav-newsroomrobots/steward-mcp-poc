/**
 * Workspace data. These mirror `UserDetailsResponse` and `LinkedOpportunity`
 * from the extension's `api-client.ts`, so the fixtures can be swapped for real
 * endpoints without touching the tools or the widget.
 */
export interface DocumentType {
    id: string;
    name: string;
    systemInstructions: string;
    tips: string[];
    sortOrder?: number;
    documentTypeEntities?: string[];
}

export interface Funder {
    id: string;
    name: string;
    lastGrantAmount?: string;
    raw: Record<string, unknown>;
}

export interface Deal {
    id: string;
    title: string;
    /** Not part of the wire contract — the fixture's join key. */
    funderId: string;
    stage?: string;
    isPrimary?: boolean;
    raw: Record<string, unknown>;
}

/** What `get_linked_objects` returns for a funder. */
export interface LinkedOpportunity {
    id: string;
    title: string;
    stage?: string;
    status?: string;
    isPrimary?: boolean;
    role?: string;
}

/** Pre-written draft for demo mode. `*` matches anything. */
export interface FallbackDraft {
    documentTypeId: string;
    funderId: string;
    text: string;
}

/** Who produced a draft version. */
export type DraftSource = 'gpt' | 'user' | 'fallback';

export interface DraftVersion {
    id: string;
    source: DraftSource;
    text: string;
    createdAt: string;
}

export type SessionStatus = 'idle' | 'generating' | 'ready' | 'failed';

export type FeedbackType = 'like' | 'dislike';

/**
 * Product-analytics events, mirroring what the extension records today. The
 * PoC keeps them in memory purely to show the tracking survives the migration.
 */
export interface SessionEvent {
    id: string;
    kind: 'feedback' | 'copy';
    versionId: string;
    feedback?: FeedbackType;
    at: string;
}

/** What the user asked for. Ids resolve against the workspace fixtures. */
export interface SessionInputs {
    documentTypeId: string;
    funderId: string;
    dealId?: string;
    userRequest: string;
    wordLimit: number;
}

export interface Session {
    id: string;
    status: SessionStatus;
    inputs: Partial<SessionInputs>;
    versions: DraftVersion[];
    events: SessionEvent[];
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
    /** The document type's `systemInstructions`, authored by the team. */
    instructions: string;
    /** Curated funder and opportunity facts from the CRM payload. */
    context: Record<string, unknown>;
    constraints: Record<string, unknown>;
    userRequest: string;
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
