import { useEffect, useState } from 'react';

interface Props {
    /** Changing this value shows the toast; the same value again re-shows it. */
    message: { text: string; at: number } | null;
}

const VISIBLE_MS = 2_400;

/** Confirmation for an action whose result is not visible in the panel — a copy
 *  landing on the clipboard, a rating reaching the server. */
export function Toast({ message }: Props) {
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (message === null) {
            return;
        }

        setShown(true);
        const timer = window.setTimeout(() => setShown(false), VISIBLE_MS);
        return () => window.clearTimeout(timer);
    }, [message]);

    return (
        <div className={`toast${shown ? ' show' : ''}`} role="status">
            {message?.text ?? ''}
        </div>
    );
}
