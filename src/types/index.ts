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

/** The other direction: what `get_linked_objects` returns for an opportunity. */
export interface LinkedFunder {
    id: string;
    name: string;
    lastGrantAmount?: string;
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

/**
 * `briefed` is where a session stops as far as the server is concerned: the
 * brief went to the model and the draft is written in the conversation. Only a
 * panel-side edit (stage 5) puts a version in the store and moves it to `ready`.
 */
export type SessionStatus = 'idle' | 'briefed' | 'ready';

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

/**
 * What the user asked for. Ids resolve against the workspace fixtures.
 *
 * Both sides are plural and neither gates the other: a session can target
 * several funders, several opportunities, or a set of opportunities whose
 * funders were never picked by hand.
 */
export interface SessionInputs {
    documentTypeId: string;
    funderIds: string[];
    dealIds: string[];
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
    /** When the brief was last handed to the model. */
    briefedAt?: string;
}

/** The package handed to the host model, which does the actual writing. */
export interface GenerationBrief {
    documentType: string;
    funders: string[];
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

/**
 * One brief handed to the model.
 *
 * There is no completion field, and that is the point: the draft is written in
 * the conversation and never comes back to the server, so whether the model
 * finished is not observable here. What remains measurable is how often each
 * orchestration variant gets as far as asking for a brief at all.
 */
export interface GenerationRun {
    runId: string;
    sessionId: string;
    variant: OrchestrationVariant;
    documentType: string;
    wordLimit: number;
    isRefinement: boolean;
    briefedAt: string;
}
