import { useState } from 'react';

import type { FeedbackType } from '../types';

interface Props {
    type: FeedbackType;
    tags: string[];
    busy: boolean;
    onSubmit: (tag: string, comment: string) => void;
    onCancel: () => void;
}

/**
 * Scenarios E2–E3 — a rating is only useful with a reason attached.
 *
 * One tag is required, exactly as in the extension: "👎" tells the team a draft
 * missed, "Missing impact or metrics" tells them what to fix. The tags come from
 * the server so the wording stays the same wherever the user rates a draft.
 */
export function FeedbackPanel({ type, tags, busy, onSubmit, onCancel }: Props) {
    const [tag, setTag] = useState<string | null>(null);
    const [comment, setComment] = useState('');

    return (
        <div className="fb">
            <div className="fb-t">
                {type === 'like' ? 'What worked?' : 'What missed?'}
                <span className="req">Required</span>
            </div>

            <div>
                {tags.map(option => (
                    <button
                        key={option}
                        type="button"
                        className={`tag${option === tag ? ' sel' : ''}`}
                        onClick={() => setTag(option)}
                    >
                        {option}
                    </button>
                ))}
            </div>

            <textarea
                value={comment}
                onChange={event => setComment(event.target.value)}
                placeholder="Optional: tell us more…"
                aria-label="Feedback comment"
            />

            <div className="w-bar">
                <span className="grow" />
                <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                    Cancel
                </button>
                <button
                    type="button"
                    className="btn primary"
                    disabled={tag === null || busy}
                    onClick={() => {
                        if (tag !== null) {
                            onSubmit(tag, comment);
                        }
                    }}
                >
                    Submit feedback
                </button>
            </div>
        </div>
    );
}
