interface Props {
    sessionId: string;
    reason: string | undefined;
    busy: boolean;
    onCheckAgain: () => void;
    onAskAgain: () => void;
    onCopySessionId: () => void;
}

/**
 * The way out of a stalled generation.
 *
 * `render_draft` is a call from the model to the server, so a generation can fail
 * in the only way the panel cannot see: the model stops after the brief. When the
 * deadline passes, the panel stops polling — and until this existed, that was a
 * dead end with the work still sitting in the model's context.
 *
 * Three exits, in the order they are usually needed: pick up a draft that arrived
 * late, ask again, or take the session id into the chat and tell the model to call
 * `render_draft` with it. The id is the part that cannot be improvised — in the
 * conversation variant it only ever appeared in the widget's own message.
 */
export function FailureRecovery({
    sessionId,
    reason,
    busy,
    onCheckAgain,
    onAskAgain,
    onCopySessionId,
}: Props) {
    return (
        <section className="card">
            <div className="banner warn">
                {reason === 'GENERATION_TIMEOUT' || reason === undefined
                    ? 'The model never sent the draft back. Nothing is lost — it may still arrive, and the letter is still in the conversation.'
                    : `Generation failed: ${reason}`}
            </div>

            <div className="w-bar">
                <button type="button" className="btn primary" onClick={onCheckAgain} disabled={busy}>
                    Check again
                </button>
                <button type="button" className="btn" onClick={onAskAgain} disabled={busy}>
                    Ask the model again
                </button>
                <span className="grow" />
                <button type="button" className="btn link" onClick={onCopySessionId} disabled={busy}>
                    ⧉ Copy session id
                </button>
            </div>

            <p className="w-meta" style={{ marginTop: 8 }}>
                Session <code>{sessionId}</code> — paste it into the chat and ask the model to call{' '}
                <code>render_draft</code> with the document it already wrote.
            </p>
        </section>
    );
}
