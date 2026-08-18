import { randomUUID } from 'node:crypto';

import type { GenerationRun, OrchestrationVariant } from '../types/index.js';

export interface RunSummary {
    briefs: number;
    rendered: number;
    refinements: number;
    /** rendered / briefs. Null before the first brief. */
    renderedRate: number | null;
    durationMs: { min: number; avg: number; max: number } | null;
}

export interface RunSnapshot {
    overall: RunSummary;
    byVariant: Record<OrchestrationVariant, RunSummary>;
    runs: GenerationRun[];
}

interface RecordInput {
    sessionId: string;
    variant: OrchestrationVariant;
    documentType: string;
    wordLimit: number;
    isRefinement: boolean;
}

/**
 * Records every brief handed to the model and every draft that came back, so
 * the two orchestration variants can be compared rather than guessed at.
 *
 * A brief without a draft is not counted as a failure and never times out: the
 * model now offers the draft and waits, so an unrendered run may simply be one
 * the user has not answered yet. Read `renderedRate` as how often the cycle
 * completed, not as a reliability score. Lives in memory and dies with the
 * process — it exists for the spike, not for production.
 */
class RunLog {
    readonly #runs: GenerationRun[] = [];

    record(input: RecordInput): GenerationRun {
        const run: GenerationRun = {
            runId: randomUUID(),
            sessionId: input.sessionId,
            variant: input.variant,
            documentType: input.documentType,
            wordLimit: input.wordLimit,
            isRefinement: input.isRefinement,
            briefedAt: new Date().toISOString(),
        };

        this.#runs.push(run);
        return run;
    }

    /**
     * Closes the newest open brief for a session. Newest rather than oldest: if
     * a model retries, the latest brief is the one that produced the text.
     */
    markRendered(sessionId: string): GenerationRun | undefined {
        const run = [...this.#runs]
            .reverse()
            .find(candidate => candidate.sessionId === sessionId && candidate.renderedAt === undefined);

        if (!run) {
            return undefined;
        }

        run.renderedAt = new Date().toISOString();
        run.durationMs = Date.parse(run.renderedAt) - Date.parse(run.briefedAt);

        return run;
    }

    snapshot(): RunSnapshot {
        const runs = [...this.#runs];

        return {
            overall: summarise(runs),
            byVariant: {
                'ui-tool-call': summarise(runs.filter(run => run.variant === 'ui-tool-call')),
                conversation: summarise(runs.filter(run => run.variant === 'conversation')),
            },
            runs,
        };
    }
}

function summarise(runs: GenerationRun[]): RunSummary {
    const rendered = runs.filter(run => run.renderedAt !== undefined);
    const durations = rendered.map(run => run.durationMs ?? 0);

    return {
        briefs: runs.length,
        rendered: rendered.length,
        refinements: runs.filter(run => run.isRefinement).length,
        renderedRate: runs.length > 0 ? Number((rendered.length / runs.length).toFixed(3)) : null,
        durationMs:
            durations.length > 0
                ? {
                      min: Math.min(...durations),
                      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
                      max: Math.max(...durations),
                  }
                : null,
    };
}

export const runLog = new RunLog();
