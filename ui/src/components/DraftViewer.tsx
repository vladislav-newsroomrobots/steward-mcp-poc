import { useEffect, useRef, useState } from 'react';

import { canonicalToText, sanitizeCanonical } from '../canonical';
import type { DraftVersion, FeedbackType } from '../types';
import { EditorToolbar } from './EditorToolbar';
import { FeedbackPanel } from './FeedbackPanel';

interface Props {
    versions: DraftVersion[];
    index: number;
    onIndex: (index: number) => void;
    feedbackTags: Record<FeedbackType, string[]>;
    meta: string;
    busy: boolean;
    onSaveEdit: (html: string, editedFrom: string) => void;
    onCopy: (version: DraftVersion, html: string, text: string) => void;
    onFeedback: (version: DraftVersion, type: FeedbackType, tag: string, comment: string) => void;
    onRefine: () => void;
    onNewSession: () => void;
}

/**
 * Scenario C1 — the draft viewer, which is where the user actually spends time.
 *
 * Versions, editing, copy and feedback are one component because they are one
 * object: every button here acts on the version currently on screen, and getting
 * that wrong means feedback landing on the wrong draft.
 *
 * The editable area is deliberately outside React's control. `contenteditable`
 * rewrites its own DOM as the user types, so the content is painted through a ref
 * and read back on save — a controlled component would fight the caret on every
 * keystroke.
 */
export function DraftViewer({
    versions,
    index,
    onIndex,
    feedbackTags,
    meta,
    busy,
    onSaveEdit,
    onCopy,
    onFeedback,
    onRefine,
    onNewSession,
}: Props) {
    const [editing, setEditing] = useState(false);
    const [feedbackFor, setFeedbackFor] = useState<FeedbackType | null>(null);
    /** Just-saved text, held until the server's version of it comes back. */
    const [pending, setPending] = useState<string | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);

    const version = versions[index];

    // A save is a round trip. Showing the pre-edit text while it is in flight
    // reads as the edit being thrown away — and if the save fails, the user's
    // words are still on screen rather than lost.
    useEffect(() => {
        setPending(null);
    }, [version?.id]);

    useEffect(() => {
        // Not while editing: repainting would discard what the user has typed.
        if (editing || editorRef.current === null) {
            return;
        }

        editorRef.current.innerHTML =
            pending ?? (version === undefined ? '' : sanitizeCanonical(version.html));
    }, [editing, version, pending]);

    if (version === undefined) {
        return null;
    }

    const editedFromIndex = versions.findIndex(item => item.id === version.editedFrom);

    const save = (): void => {
        const html = sanitizeCanonical(editorRef.current?.innerHTML ?? '');
        setPending(html);
        setEditing(false);
        onSaveEdit(html, version.id);
    };

    return (
        <section className="card">
            <div className="w-head">
                <span>Steward · draft</span>
                <span className="vnav">
                    <button
                        type="button"
                        aria-label="Previous version"
                        onClick={() => onIndex(index - 1)}
                        disabled={editing || index === 0}
                    >
                        ‹
                    </button>
                    <span className={`vbadge${version.source === 'user' ? ' edit' : ''}`}>
                        Version {index + 1} of {versions.length}
                        {version.source === 'user' ? ' · your edit' : ''}
                    </span>
                    <button
                        type="button"
                        aria-label="Next version"
                        onClick={() => onIndex(index + 1)}
                        disabled={editing || index === versions.length - 1}
                    >
                        ›
                    </button>
                </span>
            </div>

            <div className={editing ? 'editing' : undefined}>
                {editing ? <EditorToolbar editorRef={editorRef} /> : null}
                <div
                    className="draft"
                    ref={editorRef}
                    contentEditable={editing}
                    suppressContentEditableWarning
                    aria-label="Draft content"
                />
            </div>

            {editing ? (
                <div className="w-bar">
                    <span className="w-meta">Editing version {index + 1} → saves as a new version</span>
                    <span className="grow" />
                    <button type="button" className="btn" onClick={() => setEditing(false)}>
                        Cancel
                    </button>
                    <button type="button" className="btn primary" onClick={save} disabled={busy}>
                        Save
                    </button>
                </div>
            ) : (
                <div className="w-bar">
                    <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                            onCopy(version, sanitizeCanonical(version.html), canonicalToText(version.html))
                        }
                    >
                        ⧉ Copy
                    </button>
                    <button type="button" className="btn" onClick={() => setEditing(true)} disabled={busy}>
                        ✎ Edit
                    </button>
                    <button type="button" className="btn" onClick={onRefine} disabled={busy}>
                        Ask for changes
                    </button>
                    <span className="grow" />
                    {version.feedback === undefined ? (
                        <>
                            <button
                                type="button"
                                className={`btn icon${feedbackFor === 'like' ? ' on' : ''}`}
                                aria-label="Like"
                                onClick={() => setFeedbackFor(feedbackFor === 'like' ? null : 'like')}
                                disabled={busy}
                            >
                                👍
                            </button>
                            <button
                                type="button"
                                className={`btn icon${feedbackFor === 'dislike' ? ' on' : ''}`}
                                aria-label="Dislike"
                                onClick={() => setFeedbackFor(feedbackFor === 'dislike' ? null : 'dislike')}
                                disabled={busy}
                            >
                                👎
                            </button>
                        </>
                    ) : (
                        <span className="w-meta">
                            {version.feedback === 'like' ? '👍' : '👎'} {version.feedbackTag}
                        </span>
                    )}
                </div>
            )}

            {feedbackFor === null || editing || version.feedback !== undefined ? null : (
                <FeedbackPanel
                    type={feedbackFor}
                    tags={feedbackTags[feedbackFor]}
                    busy={busy}
                    onCancel={() => setFeedbackFor(null)}
                    onSubmit={(tag, comment) => {
                        setFeedbackFor(null);
                        onFeedback(version, feedbackFor, tag, comment);
                    }}
                />
            )}

            <div className="w-bar">
                <span className="w-meta">
                    {version.words} words · {version.source === 'user' ? 'your edit' : 'written by the model'}
                    {editedFromIndex === -1 ? '' : ` of version ${editedFromIndex + 1}`}
                    {version.copyCount > 0 ? ` · copied ${version.copyCount}×` : ''} · {meta}
                </span>
                <span className="grow" />
                <button type="button" className="btn link" onClick={onNewSession} disabled={busy}>
                    New document
                </button>
            </div>
        </section>
    );
}
