/** Mirrors of the tool output schemas in `src/mcp/tools/`. */

export interface DocumentTypeOption {
    id: string;
    name: string;
    tips: string[];
}

export interface FunderOption {
    id: string;
    name: string;
    lastGrantAmount?: string;
}

export interface OpportunityOption {
    id: string;
    title: string;
    stage?: string;
    isPrimary?: boolean;
}

export type FeedbackType = 'like' | 'dislike';

export interface Workspace {
    documentTypes: DocumentTypeOption[];
    funders: FunderOption[];
    feedbackTags: Record<FeedbackType, string[]>;
}

export type DraftSource = 'gpt' | 'user' | 'fallback';

export interface DraftVersion {
    id: string;
    source: DraftSource;
    /** Canonical rich text — see `canonical.ts`. */
    html: string;
    words: number;
    createdAt: string;
    editedFrom?: string;
    feedback?: FeedbackType;
    feedbackTag?: string;
    copyCount: number;
}

export type SessionStatus = 'idle' | 'generating' | 'ready' | 'failed';

export interface SessionInputs {
    documentTypeId?: string;
    funderId?: string;
    dealId?: string;
    userRequest?: string;
    wordLimit?: number;
}

export interface SessionState {
    sessionId: string;
    status: SessionStatus;
    versionCount: number;
    versions: DraftVersion[];
    latestDraft: string | null;
    inputs: SessionInputs;
    eventCount: number;
    updatedAt: string;
    failureReason?: string;
}

/** Which orchestration pattern the widget uses to start a generation. */
export type Variant = 'ui-tool-call' | 'conversation';

/** Empty string means "not chosen"; an opportunity is always optional. */
export interface Selection {
    documentTypeId: string;
    funderId: string;
    dealId: string;
}
