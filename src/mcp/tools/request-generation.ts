import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

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
    'Write the complete document now, following the instructions and word limit above,',
    'then call render_draft with the full text and the same sessionId.',
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
                documentType: z.string().optional(),
                funder: z.string().optional(),
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
                    userRequest: z.string(),
                    wordLimit: z.number(),
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
                documentType: input.documentType ?? session.inputs.documentType,
                funder: input.funder ?? session.inputs.funder,
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

            const inputs = merged as SessionInputs;
            const existingDraft = session.versions.at(-1)?.text;

            const generationBrief = buildGenerationBrief({
                ...inputs,
                ...(existingDraft === undefined ? {} : { existingDraft }),
            });

            sessionStore.markGenerating(session.id, inputs);

            const run = runLog.start({
                sessionId: session.id,
                variant: input.variant ?? 'conversation',
                documentType: inputs.documentType,
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
