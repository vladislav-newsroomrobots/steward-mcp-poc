import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import { StewardError } from '../errors.js';
import type { DraftSource, FeedbackType, Session, SessionInputs } from '../types/index.js';

export interface SessionStore {
    create(inputs?: Partial<SessionInputs>): Session;
    get(id: string): Session | undefined;
    /** Like `get`, but throws `SESSION_NOT_FOUND` instead of returning undefined. */
    require(id: string): Session;
    markGenerating(id: string, inputs: Partial<SessionInputs>): Session;
    addVersion(id: string, text: string, source: DraftSource): Session;
    /** A manual edit. Only creates a version if the text actually changed. */
    saveEdit(id: string, text: string): Session;
    addFeedback(id: string, versionId: string, type: FeedbackType): Session;
    addCopyEvent(id: string, versionId: string): Session;
    list(): Session[];
}

/** Normalised so whitespace-only edits do not create versions. */
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * In-memory store, deliberately a module singleton rather than per-MCP-session
 * state: a Steward session must survive the host reconnecting, and the widget
 * and the model reach the server over connections we do not control.
 *
 * Stage 3 replaces this with the fuller `SessionStore` from the plan; the
 * interface above is the seam.
 */
class InMemorySessionStore implements SessionStore {
    readonly #sessions = new Map<string, Session>();

    create(inputs: Partial<SessionInputs> = {}): Session {
        const now = new Date().toISOString();
        const session: Session = {
            id: randomUUID(),
            status: 'idle',
            inputs,
            versions: [],
            events: [],
            createdAt: now,
            updatedAt: now,
        };

        this.#sessions.set(session.id, session);
        return session;
    }

    get(id: string): Session | undefined {
        const session = this.#sessions.get(id);
        return session ? this.#applyTimeout(session) : undefined;
    }

    require(id: string): Session {
        const session = this.get(id);
        if (!session) {
            throw new StewardError('SESSION_NOT_FOUND', `No Steward session with id ${id}`);
        }
        return session;
    }

    markGenerating(id: string, inputs: Partial<SessionInputs>): Session {
        const session = this.require(id);
        const now = new Date().toISOString();

        session.inputs = { ...session.inputs, ...inputs };
        session.status = 'generating';
        session.generationStartedAt = now;
        session.updatedAt = now;
        delete session.failureReason;

        return session;
    }

    addVersion(id: string, text: string, source: DraftSource): Session {
        const session = this.require(id);
        const now = new Date().toISOString();

        session.versions.push({ id: randomUUID(), source, text, createdAt: now });
        session.status = 'ready';
        session.updatedAt = now;
        delete session.generationStartedAt;
        delete session.failureReason;

        return session;
    }

    saveEdit(id: string, text: string): Session {
        const session = this.require(id);
        const current = session.versions.at(-1);

        if (current && normalise(current.text) === normalise(text)) {
            return session;
        }

        return this.addVersion(id, text, 'user');
    }

    addFeedback(id: string, versionId: string, type: FeedbackType): Session {
        const session = this.require(id);
        this.#requireVersion(session, versionId);

        session.events.push({
            id: randomUUID(),
            kind: 'feedback',
            versionId,
            feedback: type,
            at: new Date().toISOString(),
        });

        return session;
    }

    addCopyEvent(id: string, versionId: string): Session {
        const session = this.require(id);
        this.#requireVersion(session, versionId);

        session.events.push({ id: randomUUID(), kind: 'copy', versionId, at: new Date().toISOString() });

        return session;
    }

    list(): Session[] {
        return [...this.#sessions.values()].map(session => this.#applyTimeout(session));
    }

    #requireVersion(session: Session, versionId: string): void {
        if (!session.versions.some(version => version.id === versionId)) {
            throw new StewardError('VERSION_NOT_FOUND', `Session ${session.id} has no version ${versionId}`);
        }
    }

    /**
     * Generation is finished by a separate tool call that may never arrive, so
     * the deadline is evaluated on read instead of with a timer. No timer to
     * leak, and a stalled session cannot sit in `generating` forever.
     */
    #applyTimeout(session: Session): Session {
        if (session.status !== 'generating' || !session.generationStartedAt) {
            return session;
        }

        const elapsed = Date.now() - Date.parse(session.generationStartedAt);
        if (elapsed <= config.GENERATION_TIMEOUT_MS) {
            return session;
        }

        session.status = 'failed';
        session.failureReason = 'GENERATION_TIMEOUT';
        session.updatedAt = new Date().toISOString();
        delete session.generationStartedAt;

        return session;
    }
}

export const sessionStore: SessionStore = new InMemorySessionStore();
