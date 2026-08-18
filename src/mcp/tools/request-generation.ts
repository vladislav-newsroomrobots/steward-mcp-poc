import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workspace } from '../../data/workspace.js';
import { StewardError } from '../../errors.js';
import { buildGenerationBrief } from '../../generation/build-brief.js';
import { runLog } from '../../store/run-log.js';
import { sessionStore } from '../../store/session-store.js';
import type { OrchestrationVariant, SessionInputs } from '../../types/index.js';
import { withToolLogging } from '../with-tool-logging.js';

interface RequestGenerationInput extends Partial<SessionInputs> {
    sessionId: string;
    existingDraft?: string;
    variant?: OrchestrationVariant;
}

/** Deduplicates while keeping the order the user picked things in. */
const unique = (ids: string[]): string[] => [...new Set(ids)];

/**
 * The instruction that decides whether the cycle completes.
 *
 * The model receives a brief, not a draft, and the whole architecture depends
 * on it continuing rather than reporting back. Repetition here is deliberate:
 * the point is repeated in the server instructions, in the tool description and
 * again in this result, because a model that stops after the brief is the
 * single failure mode that breaks the product.
 *
 * The draft itself stays in the conversation — no tool takes it back. So the
 * second half of the instruction is about pacing: write it, say it is ready,
 * and print it only once the user asks.
 */
const CONTINUATION_INSTRUCTION = [
    'Do not stop here, and do not describe this brief back to the user.',
    'Write the complete document now, following the instructions and word limit above.',
    'Hold it back for the moment — no tool takes it, and the user reads it in this chat.',
    'Then reply with one short sentence saying the draft is ready,',
    'and ask whether they would like to see it.',
    'Print the full document in your next reply, once they say yes.',
].join(' ');

export function registerRequestGenerationTool(server: McpServer): void {
    registerAppTool(
        server,
        'request_generation',
        {
            title: 'Request Steward generation',
            description:
                'Returns the generation brief for a Steward session: what to write, for whom, in what voice, and how long. Call it when the user asks for a document, then immediately write that document yourself, tell the user it is ready and ask before showing it. This tool does not generate anything by itself — you are the generator, and the draft stays in the conversation.',
            inputSchema: {
                sessionId: z.string(),
                documentTypeId: z.string().optional(),
                funderIds: z.array(z.string()).optional(),
                dealIds: z.array(z.string()).optional(),
                userRequest: z.string().optional(),
                wordLimit: z.number().int().positive().max(5000).optional(),
                existingDraft: z
                    .string()
                    .optional()
                    .describe(
                        'When the user is refining a draft you already wrote, pass its full text here. The server does not store drafts, so a refinement brief is only as good as what you pass back.',
                    ),
                variant: z
                    .enum(['ui-tool-call', 'conversation'])
                    .optional()
                    .describe('Set by the Steward interface for orchestration metrics. Leave unset.'),
            },
            outputSchema: {
                sessionId: z.string(),
                runId: z.string(),
                generationBrief: z.object({
                    documentType: z.string(),
                    funders: z.array(z.string()),
                    instructions: z.string(),
                    context: z.record(z.unknown()),
                    constraints: z.record(z.unknown()),
                    userRequest: z.string(),
                    existingDraft: z.string().optional(),
                }),
                nextStep: z.string(),
            },
            annotations: { readOnlyHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('request_generation', (input: RequestGenerationInput) => {
            const session = sessionStore.require(input.sessionId);

            // Fields fall back to what the widget stored on the session. In the
            // conversation variant the model relays them through chat, and a
            // dropped field would otherwise fail the attempt for reasons that
            // have nothing to do with the orchestration being measured.
            const merged = {
                documentTypeId: input.documentTypeId ?? session.inputs.documentTypeId,
                userRequest: input.userRequest ?? session.inputs.userRequest,
                wordLimit: input.wordLimit ?? session.inputs.wordLimit,
            };

            const missing = Object.entries(merged)
                .filter(([, value]) => value === undefined || value === '')
                .map(([key]) => key);

            const dealIds = unique(input.dealIds ?? session.inputs.dealIds ?? []);
            const pickedFunderIds = unique(input.funderIds ?? session.inputs.funderIds ?? []);

            // Either side is enough on its own. Requiring funders would put back
            // the gate the panel just dropped.
            if (pickedFunderIds.length === 0 && dealIds.length === 0) {
                missing.push('funderIds or dealIds');
            }

            if (missing.length > 0) {
                throw new StewardError(
                    'MISSING_GENERATION_INPUT',
                    `Cannot build a generation brief without: ${missing.join(', ')}`,
                );
            }

            // Unknown ids throw here, before a run is recorded — a bad id is a
            // caller error, not a generation attempt, and counting it as one
            // would corrupt the orchestration numbers.
            //
            // The funders behind the chosen opportunities are added rather than
            // assumed: an opportunity can be picked without its funder, and the
            // giving history behind it is what shapes the prose.
            const funderIds = unique([
                ...pickedFunderIds,
                ...workspace.linkedFunders(dealIds).map(linked => linked.id),
            ]);

            const inputs: SessionInputs = {
                ...(merged as Omit<SessionInputs, 'funderIds' | 'dealIds'>),
                funderIds,
                dealIds,
            };

            const documentType = workspace.documentType(inputs.documentTypeId);
            const funders = inputs.funderIds.map(id => workspace.funder(id));
            const deals = inputs.dealIds.map(id => workspace.deal(id));

            // The model's own copy comes first: drafts live in the conversation
            // now, so the store only holds a version if something else put one
            // there — a manual edit in the panel, stage 5.
            const existingDraft = input.existingDraft ?? session.versions.at(-1)?.text;

            const generationBrief = buildGenerationBrief({
                documentType,
                funders,
                deals,
                userRequest: inputs.userRequest,
                wordLimit: inputs.wordLimit,
                ...(existingDraft === undefined ? {} : { existingDraft }),
            });

            sessionStore.markBriefed(session.id, inputs);

            const run = runLog.record({
                sessionId: session.id,
                variant: input.variant ?? 'conversation',
                documentType: documentType.name,
                wordLimit: inputs.wordLimit,
                isRefinement: existingDraft !== undefined,
            });

            const payload = {
                sessionId: session.id,
                runId: run.runId,
                generationBrief,
                nextStep: CONTINUATION_INSTRUCTION,
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `${JSON.stringify({ sessionId: session.id, generationBrief }, null, 2)}\n\n${CONTINUATION_INSTRUCTION}`,
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
