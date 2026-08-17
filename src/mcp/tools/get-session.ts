import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { wordCount } from '../../generation/canonical-html.js';
import { sessionStore } from '../../store/session-store.js';
import { withToolLogging } from '../with-tool-logging.js';

/**
 * Lets the widget read session state.
 *
 * `render_draft` is called by the model, server-side, so the widget has no way
 * to be told directly that a draft arrived — it polls this while generating.
 * Hidden from the model, which has no reason to call it.
 *
 * The whole version list comes back, not just the latest: the draft viewer's
 * ‹ › navigation, the "your edit" badge and the feedback state are all read from
 * it, and one round trip is cheaper than one per version.
 */
export function registerGetSessionTool(server: McpServer): void {
    registerAppTool(
        server,
        'get_session',
        {
            title: 'Get Steward session',
            description:
                'Returns the current state of a Steward drafting session, including its draft versions. Used by the Steward interface.',
            inputSchema: { sessionId: z.string() },
            outputSchema: {
                sessionId: z.string(),
                status: z.string(),
                versionCount: z.number(),
                versions: z.array(
                    z.object({
                        id: z.string(),
                        source: z.string(),
                        html: z.string(),
                        words: z.number(),
                        createdAt: z.string(),
                        editedFrom: z.string().optional(),
                        feedback: z.string().optional(),
                        feedbackTag: z.string().optional(),
                        copyCount: z.number(),
                    }),
                ),
                latestDraft: z.string().nullable(),
                inputs: z.object({
                    documentTypeId: z.string().optional(),
                    funderId: z.string().optional(),
                    dealId: z.string().optional(),
                    userRequest: z.string().optional(),
                    wordLimit: z.number().optional(),
                }),
                eventCount: z.number(),
                updatedAt: z.string(),
                failureReason: z.string().optional(),
            },
            annotations: { readOnlyHint: true, openWorldHint: false },
            _meta: { ui: { visibility: ['app'] } },
        },
        withToolLogging('get_session', ({ sessionId }: { sessionId: string }) => {
            const session = sessionStore.require(sessionId);
            const latest = session.versions.at(-1);

            const versions = session.versions.map(version => {
                const feedback = session.events.find(
                    event => event.kind === 'feedback' && event.versionId === version.id,
                );

                return {
                    id: version.id,
                    source: version.source,
                    html: version.html,
                    words: wordCount(version.html),
                    createdAt: version.createdAt,
                    ...(version.editedFrom === undefined ? {} : { editedFrom: version.editedFrom }),
                    ...(feedback?.feedback === undefined ? {} : { feedback: feedback.feedback }),
                    ...(feedback?.tag === undefined ? {} : { feedbackTag: feedback.tag }),
                    copyCount: session.events.filter(
                        event => event.kind === 'copy' && event.versionId === version.id,
                    ).length,
                };
            });

            const payload = {
                sessionId: session.id,
                status: session.status,
                versionCount: session.versions.length,
                versions,
                latestDraft: latest?.html ?? null,
                inputs: session.inputs,
                eventCount: session.events.length,
                updatedAt: session.updatedAt,
                ...(session.failureReason === undefined ? {} : { failureReason: session.failureReason }),
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
