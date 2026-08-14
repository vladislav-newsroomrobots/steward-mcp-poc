import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import { StewardError } from '../errors.js';
import type { DraftSource, Session, SessionInputs } from '../types/index.js';

export interface SessionStore {
    create(inputs?: Partial<SessionInputs>): Session;
    get(id: string): Session | undefined;
    /** Like `get`, but throws `SESSION_NOT_FOUND` instead of returning undefined. */
    require(id: string): Session;
    markGenerating(id: string, inputs: Partial<SessionInputs>): Session;
    addVersion(id: string, text: string, source: DraftSource): Session;
    list(): Session[];
}

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

    list(): Session[] {
        return [...this.#sessions.values()].map(session => this.#applyTimeout(session));
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
