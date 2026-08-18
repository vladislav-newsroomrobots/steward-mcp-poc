import { randomUUID } from 'node:crypto';

import type { GenerationRun, OrchestrationVariant } from '../types/index.js';

export interface RunSummary {
    briefs: number;
    refinements: number;
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
 * Records every brief handed to the model, so the two orchestration variants can
 * be compared by how often each one actually reaches `request_generation`.
 *
 * It deliberately does not track completion. The draft is written in the
 * conversation and never returns to the server, so there is no call to observe;
 * claiming a success rate from here would be inventing one. Judge the finished
 * document in the chat instead. Lives in memory and dies with the process.
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
    return {
        briefs: runs.length,
        refinements: runs.filter(run => run.isRefinement).length,
    };
}

export const runLog = new RunLog();
