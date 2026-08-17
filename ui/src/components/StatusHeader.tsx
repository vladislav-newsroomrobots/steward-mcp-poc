export type PanelState = 'connecting' | 'connected' | 'generating' | 'ready' | 'failed' | 'error';

interface Props {
    state: PanelState;
    label: string;
    detail: string;
}

/** Panel identity on the left, what the panel is doing on the right. */
export function StatusHeader({ state, label, detail }: Props) {
    return (
        <div className="w-head">
            <span className="brand">Steward</span>
            <span className="w-meta">{detail}</span>
            <span className="state" data-state={state}>
                <span className="dot" />
                {label}
            </span>
        </div>
    );
}
