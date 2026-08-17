import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { FEEDBACK_TAGS } from '../../data/feedback-tags.js';
import { logger } from '../../logger.js';
import { sessionStore } from '../../store/session-store.js';
import type { FeedbackType } from '../../types/index.js';
import { withToolLogging } from '../with-tool-logging.js';

interface FeedbackInput {
    sessionId: string;
    versionId: string;
    feedback: FeedbackType;
    tag: string;
    comment?: string;
}

/**
 * A rating with a required tag, exactly as the extension collects it.
 *
 * The tag is what makes the signal usable — "👎" says a draft missed, "Missing
 * impact or metrics" says how. The store rejects an unknown tag and a second
 * rating on the same version rather than quietly recording either.
 */
export function registerSubmitFeedbackTool(server: McpServer): void {
    registerAppTool(
        server,
        'submit_feedback',
        {
            title: 'Submit Steward feedback',
            description:
                'Records the user\'s rating of a draft version. One tag is required: like → ' +
                FEEDBACK_TAGS.like.join(' | ') +
                '; dislike → ' +
                FEEDBACK_TAGS.dislike.join(' | ') +
                '. Ask the user which one fits rather than choosing for them, and never rate a draft on your own initiative.',
            inputSchema: {
                sessionId: z.string(),
                versionId: z.string(),
                feedback: z.enum(['like', 'dislike']),
                tag: z.string().describe('Exactly one tag from the list for this rating.'),
                comment: z.string().optional(),
            },
            outputSchema: {
                sessionId: z.string(),
                versionId: z.string(),
                feedback: z.string(),
                tag: z.string(),
                eventCount: z.number(),
            },
            annotations: { openWorldHint: false },
            _meta: { ui: { visibility: ['model', 'app'] } },
        },
        withToolLogging('submit_feedback', ({ sessionId, versionId, feedback, tag, comment }: FeedbackInput) => {
            const session = sessionStore.addFeedback(sessionId, versionId, feedback, tag, comment);

            logger.info('feedback recorded', { sessionId, versionId, feedback, tag });

            const payload = {
                sessionId: session.id,
                versionId,
                feedback,
                tag,
                eventCount: session.events.length,
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Recorded: ${feedback} · "${tag}". Thank the user briefly; do not restate the draft.`,
                    },
                ],
                structuredContent: payload,
            };
        }),
    );
}
