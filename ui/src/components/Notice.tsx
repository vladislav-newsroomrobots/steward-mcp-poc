export type NoticeKind = 'ok' | 'warn' | 'err';

export interface NoticeValue {
    kind: NoticeKind;
    text: string;
}

interface Props {
    notice: NoticeValue | null;
    onDismiss?: () => void;
}

/**
 * Plain-language outcomes, in the extension's banner styling.
 *
 * Every failure the panel can hit gets one of these rather than a raw error
 * string — scenario block H of the walkthrough is entirely about that promise.
 */
export function Notice({ notice, onDismiss }: Props) {
    if (notice === null) {
        return null;
    }

    return (
        <div className={`banner ${notice.kind}`} role="status">
            <span className="grow">{notice.text}</span>
            {onDismiss === undefined ? null : (
                <button type="button" className="btn link" onClick={onDismiss}>
                    Dismiss
                </button>
            )}
        </div>
    );
}
