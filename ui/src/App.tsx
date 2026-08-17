import { useEffect, useMemo, useRef, useState } from 'react';

import { copyPlainText, copyRichText } from './clipboard';
import { ContextPicker } from './components/ContextPicker';
import { DraftViewer } from './components/DraftViewer';
import { FailureRecovery } from './components/FailureRecovery';
import { Notice, type NoticeValue } from './components/Notice';
import { SessionSummary } from './components/SessionSummary';
import { StatusHeader, type PanelState } from './components/StatusHeader';
import { SuggestedContext } from './components/SuggestedContext';
import { Toast } from './components/Toast';
import { ToolError, callTool, connectHost, describeError, sendMessage } from './host';
import { suggestDocumentTypes, suggestFunders, suggestOpportunities } from './suggest';
import type {
    DraftVersion,
    FeedbackType,
    OpportunityOption,
    Selection,
    SessionState,
    Variant,
    Workspace,
} from './types';

/**
 * The Steward panel.
 *
 * State lives here rather than in the pieces because the pieces act on the same
 * object: the picker decides what the next version is written from, the viewer
 * acts on the version currently on screen, and both read the session the server
 * owns. The components below are presentation with callbacks.
 *
 * The one thing worth knowing about the flow: `render_draft` is a call from the
 * model to the server, so nothing tells this widget that a draft arrived. It polls
 * `get_session` and watches the version count grow.
 */

const POLL_INTERVAL_MS = 1_500;
/** Longer than the server's own generation deadline, so its verdict wins. */
const POLL_TIMEOUT_MS = 150_000;
const DEFAULT_WORD_LIMIT = 300;

export function App() {
    const [panel, setPanel] = useState<PanelState>('connecting');
    const [hostLabel, setHostLabel] = useState('connecting…');
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [notice, setNotice] = useState<NoticeValue | null>(null);
    const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

    const [selection, setSelection] = useState<Selection>({ documentTypeId: '', funderId: '', dealId: '' });
    const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
    const [opportunitiesState, setOpportunitiesState] = useState<'idle' | 'loading' | 'error'>('idle');

    const [request, setRequest] = useState('');
    const [wordLimit, setWordLimit] = useState(DEFAULT_WORD_LIMIT);
    const [variant, setVariant] = useState<Variant>('conversation');

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [session, setSession] = useState<SessionState | null>(null);
    const [index, setIndex] = useState(0);
    const [generating, setGenerating] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [busy, setBusy] = useState(false);
    const [showContext, setShowContext] = useState(true);

    /** Version count when the current generation started — see the poll below. */
    const baseline = useRef(0);
    const startedAt = useRef(0);

    const say = (text: string): void => setToast({ text, at: Date.now() });

    // ── host handshake and workspace ─────────────────────────────────────

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const host = await connectHost();
                if (cancelled) {
                    return;
                }

                setHostLabel(`host: ${host}`);

                const loaded = await callTool<Workspace>('get_workspace');
                if (cancelled) {
                    return;
                }

                setWorkspace(loaded);
                setSelection(current => ({
                    ...current,
                    documentTypeId:
                        current.documentTypeId === ''
                            ? (loaded.documentTypes[0]?.id ?? '')
                            : current.documentTypeId,
                }));
                setPanel('connected');
            } catch (error) {
                if (!cancelled) {
                    setPanel('error');
                    setNotice({ kind: 'err', text: `Could not reach the host: ${describeError(error)}` });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Opportunities belong to a funder, so they load once one is picked — the
    // full deal graph is far larger than any one draft needs.
    useEffect(() => {
        if (selection.funderId === '') {
            setOpportunities([]);
            setOpportunitiesState('idle');
            return;
        }

        let cancelled = false;
        setOpportunitiesState('loading');

        void (async () => {
            try {
                const { opportunities: linked } = await callTool<{ opportunities: OpportunityOption[] }>(
                    'get_linked_objects',
                    { funderId: selection.funderId },
                );

                if (!cancelled) {
                    setOpportunities(linked);
                    setOpportunitiesState('idle');
                }
            } catch {
                if (!cancelled) {
                    setOpportunities([]);
                    setOpportunitiesState('error');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selection.funderId]);

    // ── waiting for the model ────────────────────────────────────────────

    useEffect(() => {
        if (!generating || sessionId === null) {
            return;
        }

        const poll = async (): Promise<void> => {
            try {
                const state = await callTool<SessionState>('get_session', { sessionId });
                setSession(state);

                // A new version, not `status === 'ready'`: a refinement starts from
                // a session that is already ready, and in variant B the status only
                // flips once the model gets around to calling request_generation.
                if (state.versionCount > baseline.current) {
                    setGenerating(false);
                    setIndex(state.versionCount - 1);
                    setShowContext(false);
                    setNotice(null);
                    setPanel('ready');
                    return;
                }

                // Both dead ends hand over to <FailureRecovery>, which owns the
                // explanation and the three ways out of it.
                if (state.status === 'failed' || Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
                    setGenerating(false);
                    setPanel('failed');
                }
            } catch (error) {
                setGenerating(false);
                setPanel('error');
                setNotice({ kind: 'err', text: `Lost track of the session: ${describeError(error)}` });
            }
        };

        const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [generating, sessionId]);

    useEffect(() => {
        if (!generating) {
            setElapsed(0);
            return;
        }

        const timer = window.setInterval(
            () => setElapsed(Math.round((Date.now() - startedAt.current) / 1_000)),
            1_000,
        );
        return () => window.clearInterval(timer);
    }, [generating]);

    // ── derived ─────────────────────────────────────────────────────────

    const documentType = workspace?.documentTypes.find(type => type.id === selection.documentTypeId);
    const funder = workspace?.funders.find(item => item.id === selection.funderId);
    const opportunity = opportunities.find(item => item.id === selection.dealId);
    const versions = session?.versions ?? [];
    const currentIndex = Math.min(index, Math.max(versions.length - 1, 0));

    const suggestions = useMemo(() => {
        const text = request.trim();

        if (workspace === null || text === '') {
            return { documentTypes: [], funders: [], opportunities: [] };
        }

        const typeMatches = suggestDocumentTypes(text, workspace.documentTypes).filter(
            match => match.item.id !== selection.documentTypeId,
        );

        return {
            // Only suggest what the user has not already chosen — a panel that
            // repeats the current selection back is noise.
            documentTypes: typeMatches.slice(0, 2),
            funders: selection.funderId === '' ? suggestFunders(text, workspace.funders) : [],
            opportunities:
                selection.funderId !== '' && selection.dealId === ''
                    ? suggestOpportunities(text, opportunities)
                    : [],
        };
    }, [request, workspace, selection.documentTypeId, selection.funderId, selection.dealId, opportunities]);

    // ── actions ─────────────────────────────────────────────────────────

    const refresh = async (id: string): Promise<SessionState> => {
        const state = await callTool<SessionState>('get_session', { sessionId: id });
        setSession(state);
        return state;
    };

    const generate = async (): Promise<void> => {
        if (documentType === undefined || funder === undefined || request.trim() === '') {
            setNotice({ kind: 'warn', text: 'A document type, a funder and a request are all needed.' });
            return;
        }

        const inputs = {
            documentTypeId: documentType.id,
            funderId: funder.id,
            ...(selection.dealId === '' ? {} : { dealId: selection.dealId }),
            userRequest: request.trim(),
            wordLimit,
        };

        setBusy(true);
        setNotice(null);

        try {
            const id = sessionId ?? (await callTool<{ sessionId: string }>('create_session', inputs)).sessionId;
            setSessionId(id);

            baseline.current = session?.versionCount ?? 0;
            startedAt.current = Date.now();
            setGenerating(true);
            setPanel('generating');

            if (variant === 'ui-tool-call') {
                // Variant A: the widget asks for the brief itself, and the model
                // has to notice the tool result and carry on unprompted.
                await callTool('request_generation', { sessionId: id, ...inputs, variant });
            } else {
                // Variant B: hand the work to the conversation and let the model
                // drive the whole cycle, which is the path hosts are tuned for.
                await sendMessage(
                    [
                        'Steward request — please handle this now.',
                        `sessionId: ${id}`,
                        `documentTypeId: ${inputs.documentTypeId}`,
                        `funderId: ${inputs.funderId}`,
                        ...(inputs.dealId === undefined ? [] : [`dealId: ${inputs.dealId}`]),
                        `Word limit: ${inputs.wordLimit}`,
                        `Request: ${inputs.userRequest}`,
                        '',
                        'Call request_generation with that sessionId, write the document,',
                        'then call render_draft with the full document.',
                    ].join('\n'),
                );
            }
        } catch (error) {
            setGenerating(false);
            setPanel('error');
            setNotice({ kind: 'err', text: `Could not start generating: ${describeError(error)}` });
        } finally {
            setBusy(false);
        }
    };

    /** Scenario B1 — the selection goes back to the chat as the user's own message. */
    const sendContextToChat = async (): Promise<void> => {
        if (documentType === undefined || funder === undefined) {
            return;
        }

        try {
            await sendMessage(
                `Use this Steward context: document type = ${documentType.name}; funder = ${funder.name}` +
                    (opportunity === undefined ? '' : `; opportunity = ${opportunity.title}`) +
                    (request.trim() === '' ? '' : `. ${request.trim()}`),
            );
            say('Sent to the chat as your message');
        } catch (error) {
            setNotice({ kind: 'err', text: `Could not send that to the chat: ${describeError(error)}` });
        }
    };

    const saveEdit = async (html: string, editedFrom: string): Promise<void> => {
        if (sessionId === null) {
            return;
        }

        setBusy(true);

        try {
            const result = await callTool<{ unchanged: boolean; versionCount: number }>('save_edit', {
                sessionId,
                html,
                editedFrom,
            });
            const state = await refresh(sessionId);

            if (result.unchanged) {
                say('Nothing changed, so no new version');
            } else {
                setIndex(state.versionCount - 1);
                say(`Saved as version ${result.versionCount} · your edit`);
            }
        } catch (error) {
            setNotice({ kind: 'err', text: `Could not save the edit: ${describeError(error)}` });
        } finally {
            setBusy(false);
        }
    };

    const copy = async (version: DraftVersion, html: string, text: string): Promise<void> => {
        try {
            await copyRichText(html, text);
        } catch (error) {
            setNotice({ kind: 'warn', text: `The host blocked the clipboard: ${describeError(error)}` });
            return;
        }

        say('Copied — rich text and plain text');

        if (sessionId === null) {
            return;
        }

        try {
            await callTool('track_copy', { sessionId, versionId: version.id });
            await refresh(sessionId);
        } catch {
            // The copy already happened; failing to count it is not the user's
            // problem and not worth a banner.
        }
    };

    const submitFeedback = async (
        version: DraftVersion,
        feedback: FeedbackType,
        tag: string,
        comment: string,
    ): Promise<void> => {
        if (sessionId === null) {
            return;
        }

        setBusy(true);

        try {
            await callTool('submit_feedback', {
                sessionId,
                versionId: version.id,
                feedback,
                tag,
                ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
            });
            await refresh(sessionId);
            say(`Thanks — recorded ${feedback === 'like' ? '👍' : '👎'} "${tag}"`);
        } catch (error) {
            // Scenario H1: a second rating on the same version is a modelled
            // outcome, not a failure, and reads as one.
            setNotice(
                error instanceof ToolError && error.code === 'FEEDBACK_ALREADY_GIVEN'
                    ? {
                          kind: 'warn',
                          text: 'This version already has feedback. Rate a different version instead.',
                      }
                    : { kind: 'err', text: `Could not record that: ${describeError(error)}` },
            );
        } finally {
            setBusy(false);
        }
    };

    /**
     * A draft that arrives after the deadline is still a draft. The server accepts
     * a late `render_draft`, so one read is enough to find out.
     */
    const checkAgain = async (): Promise<void> => {
        if (sessionId === null) {
            return;
        }

        setBusy(true);

        try {
            const state = await refresh(sessionId);

            if (state.versionCount > baseline.current) {
                setIndex(state.versionCount - 1);
                setShowContext(false);
                setNotice(null);
                setPanel('ready');
                say('The draft arrived after all');
            } else {
                setNotice({
                    kind: 'warn',
                    text: 'Still nothing — the model has not called render_draft for this session.',
                });
            }
        } catch (error) {
            setNotice({ kind: 'err', text: `Could not read the session: ${describeError(error)}` });
        } finally {
            setBusy(false);
        }
    };

    const copySessionId = async (): Promise<void> => {
        if (sessionId === null) {
            return;
        }

        try {
            await copyPlainText(sessionId);
            say('Session id copied — paste it into the chat');
        } catch {
            // The id is on screen and selectable either way.
            setNotice({ kind: 'warn', text: `The host blocked the clipboard. The session id is ${sessionId}.` });
        }
    };

    const startNewDocument = (): void => {
        setSessionId(null);
        setSession(null);
        setIndex(0);
        setGenerating(false);
        setRequest('');
        setNotice(null);
        setShowContext(true);
        setPanel('connected');
        say('Started a new document — the previous session is kept on the server');
    };

    // ── render ──────────────────────────────────────────────────────────

    const statusLabel: Record<PanelState, string> = {
        connecting: 'Connecting',
        connected: 'Connected',
        generating: `Generating ${elapsed}s`,
        ready: 'Draft ready',
        failed: 'Failed',
        error: 'Error',
    };

    return (
        <div className="app">
            <StatusHeader state={panel} label={statusLabel[panel]} detail={hostLabel} />

            <Notice notice={notice} onDismiss={() => setNotice(null)} />

            {workspace === null ? (
                <p className="w-meta">{panel === 'error' ? 'Not connected.' : 'Loading your workspace…'}</p>
            ) : (
                <>
                    {session !== null && session.versionCount > 0 ? (
                        <SessionSummary
                            session={session}
                            documentTypeName={documentType?.name}
                            funderName={funder?.name}
                            opportunityTitle={opportunity?.title}
                        />
                    ) : null}

                    {generating ? (
                        <div className="banner warn">
                            Writing the document — waiting for the model to send it back ({elapsed}s).
                        </div>
                    ) : null}

                    {panel === 'failed' && !generating && sessionId !== null ? (
                        <FailureRecovery
                            sessionId={sessionId}
                            reason={session?.failureReason}
                            busy={busy}
                            onCheckAgain={() => void checkAgain()}
                            onAskAgain={() => void generate()}
                            onCopySessionId={() => void copySessionId()}
                        />
                    ) : null}

                    {versions.length > 0 ? (
                        <DraftViewer
                            versions={versions}
                            index={currentIndex}
                            onIndex={setIndex}
                            feedbackTags={workspace.feedbackTags}
                            meta={`word limit ${wordLimit}`}
                            busy={busy || generating}
                            onSaveEdit={(html, editedFrom) => void saveEdit(html, editedFrom)}
                            onCopy={(version, html, text) => void copy(version, html, text)}
                            onFeedback={(version, feedback, tag, comment) =>
                                void submitFeedback(version, feedback, tag, comment)
                            }
                            onRefine={() => {
                                setRequest('');
                                setShowContext(true);
                            }}
                            onNewSession={startNewDocument}
                        />
                    ) : null}

                    {showContext ? (
                        <>
                            <SuggestedContext
                                documentTypes={suggestions.documentTypes}
                                funders={suggestions.funders}
                                opportunities={suggestions.opportunities}
                                selection={selection}
                                onPick={patch => setSelection(current => ({ ...current, ...patch }))}
                                {...(versions.length > 0
                                    ? {
                                          continueLabel: `Back to the current draft — ${versions.length} version${
                                              versions.length === 1 ? '' : 's'
                                          }`,
                                          onContinue: () => setShowContext(false),
                                      }
                                    : {})}
                                busy={busy || generating}
                            />

                            <ContextPicker
                                workspace={workspace}
                                selection={selection}
                                onSelect={patch => setSelection(current => ({ ...current, ...patch }))}
                                opportunities={opportunities}
                                opportunitiesState={opportunitiesState}
                                request={request}
                                onRequest={setRequest}
                                wordLimit={wordLimit}
                                onWordLimit={setWordLimit}
                                variant={variant}
                                onVariant={setVariant}
                                busy={busy || generating}
                                generateLabel={
                                    versions.length === 0
                                        ? 'Generate ↗'
                                        : `Generate version ${versions.length + 1} ↗`
                                }
                                onGenerate={() => void generate()}
                                onSendToChat={() => void sendContextToChat()}
                            />
                        </>
                    ) : null}
                </>
            )}

            <Toast message={toast} />
        </div>
    );
}
