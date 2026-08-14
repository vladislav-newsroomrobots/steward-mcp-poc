import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import type { GenerationRun, OrchestrationVariant } from '../types/index.js';

export interface RunSummary {
    attempts: number;
    rendered: number;
    timedOut: number;
    pending: number;
    /** rendered / (attempts - pending), i.e. the stage 2 success metric. */
    successRate: number | null;
    durationMs: { min: number; avg: number; max: number } | null;
}

export interface RunSnapshot {
    overall: RunSummary;
    byVariant: Record<OrchestrationVariant, RunSummary>;
    runs: GenerationRun[];
}

interface StartInput {
    sessionId: string;
    variant: OrchestrationVariant;
    documentType: string;
    wordLimit: number;
    isRefinement: boolean;
}

/**
 * Records every `request_generation → render_draft` attempt so the stage 2
 * reliability target can be measured instead of estimated. Lives in memory and
 * dies with the process — it exists for the spike, not for production.
 */
class RunLog {
    readonly #runs: GenerationRun[] = [];

    start(input: StartInput): GenerationRun {
        const run: GenerationRun = {
            runId: randomUUID(),
            sessionId: input.sessionId,
            variant: input.variant,
            documentType: input.documentType,
            wordLimit: input.wordLimit,
            isRefinement: input.isRefinement,
            startedAt: new Date().toISOString(),
            requestGenerationCalled: true,
            renderDraftCalled: false,
            result: 'pending',
        };

        this.#runs.push(run);
        return run;
    }

    /**
     * Closes the newest open attempt for a session. Newest rather than oldest:
     * if a model retries, the latest attempt is the one that produced the text.
     */
    complete(sessionId: string): GenerationRun | undefined {
        const run = [...this.#runs]
            .reverse()
            .find(candidate => candidate.sessionId === sessionId && candidate.result === 'pending');

        if (!run) {
            return undefined;
        }

        run.renderDraftCalled = true;
        run.result = 'rendered';
        run.durationMs = Date.now() - Date.parse(run.startedAt);

        return run;
    }

    snapshot(): RunSnapshot {
        const runs = this.#runs.map(run => this.#applyTimeout(run));

        return {
            overall: summarise(runs),
            byVariant: {
                'ui-tool-call': summarise(runs.filter(run => run.variant === 'ui-tool-call')),
                conversation: summarise(runs.filter(run => run.variant === 'conversation')),
            },
            runs,
        };
    }

    #applyTimeout(run: GenerationRun): GenerationRun {
        if (run.result !== 'pending') {
            return run;
        }

        if (Date.now() - Date.parse(run.startedAt) > config.GENERATION_TIMEOUT_MS) {
            run.result = 'timeout';
            run.failureReason = 'render_draft was never called';
        }

        return run;
    }
}

function summarise(runs: GenerationRun[]): RunSummary {
    const rendered = runs.filter(run => run.result === 'rendered');
    const timedOut = runs.filter(run => run.result === 'timeout').length;
    const pending = runs.filter(run => run.result === 'pending').length;
    const decided = runs.length - pending;

    const durations = rendered.map(run => run.durationMs ?? 0);

    return {
        attempts: runs.length,
        rendered: rendered.length,
        timedOut,
        pending,
        successRate: decided > 0 ? Number((rendered.length / decided).toFixed(3)) : null,
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
