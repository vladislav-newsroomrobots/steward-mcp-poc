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
    variant?: OrchestrationVariant;
}

/**
 * The instruction that decides whether the cycle completes.
 *
 * The model receives a brief, not a draft, and the whole architecture depends
 * on it continuing rather than reporting back. Repetition here is deliberate:
 * the point is repeated in the server instructions, in the tool description and
 * again in this result, because a model that stops after the brief is the
 * single failure mode that breaks the product.
 */
const CONTINUATION_INSTRUCTION = [
    'Do not stop here, and do not describe this brief back to the user.',
    'Write the complete document now, following the instructions, word limit and format above,',
    'then call render_draft with the full document and the same sessionId.',
    'Send the document through render_draft rather than writing it into the chat;',
    'the user reads it in the Steward panel. Keep your chat reply to one short sentence.',
].join(' ');

export function registerRequestGenerationTool(server: McpServer): void {
    registerAppTool(
        server,
        'request_generation',
        {
            title: 'Request Steward generation',
            description:
                'Returns the generation brief for a Steward session: what to write, for whom, in what voice, and how long. Call it when the user asks for a document, then immediately write that document and pass it to render_draft. This tool does not generate anything by itself — you are the generator.',
            inputSchema: {
                sessionId: z.string(),
                documentTypeId: z.string().optional(),
                funderId: z.string().optional(),
                dealId: z.string().optional(),
                userRequest: z.string().optional(),
                wordLimit: z.number().int().positive().max(5000).optional(),
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
                    funder: z.string(),
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
                funderId: input.funderId ?? session.inputs.funderId,
                userRequest: input.userRequest ?? session.inputs.userRequest,
                wordLimit: input.wordLimit ?? session.inputs.wordLimit,
            };

            const missing = Object.entries(merged)
                .filter(([, value]) => value === undefined || value === '')
                .map(([key]) => key);

            if (missing.length > 0) {
                throw new StewardError(
                    'MISSING_GENERATION_INPUT',
                    `Cannot build a generation brief without: ${missing.join(', ')}`,
                );
            }

            const dealId = input.dealId ?? session.inputs.dealId;
            const inputs: SessionInputs = {
                ...(merged as Omit<SessionInputs, 'dealId'>),
                ...(dealId === undefined ? {} : { dealId }),
            };

            // Unknown ids throw here, before a run is recorded — a bad id is a
            // caller error, not a failed generation attempt, and counting it as
            // one would corrupt the reliability metric.
            const documentType = workspace.documentType(inputs.documentTypeId);
            const funder = workspace.funder(inputs.funderId);
            const deal = inputs.dealId === undefined ? undefined : workspace.deal(inputs.dealId);

            const existingDraft = session.versions.at(-1)?.html;

            const generationBrief = buildGenerationBrief({
                documentType,
                funder,
                ...(deal === undefined ? {} : { deal }),
                userRequest: inputs.userRequest,
                wordLimit: inputs.wordLimit,
                ...(existingDraft === undefined ? {} : { existingDraft }),
            });

            sessionStore.markGenerating(session.id, inputs);

            const run = runLog.start({
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
