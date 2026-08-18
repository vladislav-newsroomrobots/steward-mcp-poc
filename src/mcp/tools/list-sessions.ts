import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { workspace } from '../../data/workspace.js';
import { sessionStore } from '../../store/session-store.js';
import type { Session } from '../../types/index.js';
import { STEWARD_SESSIONS_URI } from '../resources/widgets.js';
import { withToolLogging } from '../with-tool-logging.js';

/** Enough of a draft to recognise it in a list, without reprinting it. */
const PREVIEW_LENGTH = 140;

/**
 * Ids are resolved to names here rather than in the widget.
 *
 * A session keeps whatever ids it was opened with, and a fixture can be edited
 * out from under one. Falling back to the id keeps a stale session listable
 * instead of failing the whole call over one row.
 */
function funderName(id: string): string {
    try {
        return workspace.funder(id).name;
    } catch {
        return id;
    }
}

function opportunityTitle(id: string): string {
    try {
        return workspace.deal(id).title;
    } catch {
        return id;
    }
}

function documentTypeName(id: string | undefined): string | undefined {
    if (id === undefined) {
        return undefined;
    }

    try {
        return workspace.documentType(id).name;
    } catch {
        return id;
    }
}

function summarise(session: Session) {
    const latest = session.versions.at(-1)?.text;
    const documentType = documentTypeName(session.inputs.documentTypeId);
    const preview =
        latest === undefined
            ? undefined
            : latest.length > PREVIEW_LENGTH
              ? `${latest.slice(0, PREVIEW_LENGTH).trimEnd()}…`
              : latest;

    return {
        sessionId: session.id,
        status: session.status,
        ...(documentType === undefined ? {} : { documentType }),
        funders: (session.inputs.funderIds ?? []).map(funderName),
        opportunities: (session.inputs.dealIds ?? []).map(opportunityTitle),
        versionCount: session.versions.length,
        ...(preview === undefined ? {} : { latestDraftPreview: preview }),
        updatedAt: session.updatedAt,
    };
}

/**
 * Every drafting session in the workspace, newest first, in its own panel.
 *
 * Visible to the model as well as the widget: asking what has been drafted is a
 * reasonable thing to say in chat, and the answer is a panel rather than a list
 * the model has to read back.
 */
export function registerListSessionsTool(server: McpServer): void {
    registerAppTool(
        server,
        'list_sessions',
        {
            title: 'List Steward sessions',
            description:
                'Opens a panel listing every Steward drafting session in this workspace — document type, funders, opportunities, how many versions exist and a preview of the latest draft. Call it when the user asks what has been drafted so far.',
            inputSchema: {},
            outputSchema: {
                sessions: z.array(
                    z.object({
                        sessionId: z.string(),
                        status: z.string(),
                        documentType: z.string().optional(),
                        funders: z.array(z.string()),
                        opportunities: z.array(z.string()),
                        versionCount: z.number(),
                        latestDraftPreview: z.string().optional(),
                        updatedAt: z.string(),
                    }),
                ),
            },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            _meta: { ui: { resourceUri: STEWARD_SESSIONS_URI, visibility: ['model', 'app'] } },
        },
        withToolLogging('list_sessions', () => {
            const sessions = sessionStore
                .list()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map(summarise);

            const payload = { sessions };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
                structuredContent: payload,
            };
        }),
    );
}
