import type { Suggestion } from '../suggest';
import type { DocumentTypeOption, FunderOption, OpportunityOption } from '../types';

interface Props {
    documentTypes: Suggestion<DocumentTypeOption>[];
    funders: Suggestion<FunderOption>[];
    opportunities: Suggestion<OpportunityOption>[];
    selection: { documentTypeId: string; funderId: string; dealId: string };
    onPick: (patch: { documentTypeId?: string; funderId?: string; dealId?: string }) => void;
    continueLabel?: string | undefined;
    onContinue?: (() => void) | undefined;
    busy: boolean;
}

interface ListProps<T> {
    heading: string;
    items: Suggestion<T>[];
    selectedId: string;
    label: (item: T) => string;
    onPick: (id: string) => void;
    busy: boolean;
}

function SuggestionList<T extends { id: string }>({
    heading,
    items,
    selectedId,
    label,
    onPick,
    busy,
}: ListProps<T>) {
    if (items.length === 0) {
        return null;
    }

    return (
        <>
            <p className="sg-sec">{heading}</p>
            {items.map(({ item, reasons }) => (
                <button
                    key={item.id}
                    type="button"
                    className={`sug${item.id === selectedId ? ' sel' : ''}`}
                    onClick={() => onPick(item.id)}
                    disabled={busy}
                >
                    <span>
                        <span className="s-n">{label(item)}</span>
                        <span className="s-r">
                            {reasons.map(reason => (
                                <span key={reason.label} className={`why${reason.hot === true ? ' hot' : ''}`}>
                                    {reason.label}
                                </span>
                            ))}
                        </span>
                    </span>
                    <span className="w-meta">{item.id === selectedId ? '✓ selected' : '＋'}</span>
                </button>
            ))}
        </>
    );
}

/**
 * Scenario C0 — the user described the document but named nobody, so Steward
 * proposes who it is probably for instead of handing them an empty form.
 *
 * One tap instead of hunting through the picker. The reasons are the point: a
 * ranking the user cannot see is a ranking they cannot correct.
 */
export function SuggestedContext({
    documentTypes,
    funders,
    opportunities,
    selection,
    onPick,
    continueLabel,
    onContinue,
    busy,
}: Props) {
    if (
        documentTypes.length === 0 &&
        funders.length === 0 &&
        opportunities.length === 0 &&
        onContinue === undefined
    ) {
        return null;
    }

    return (
        <section className="card">
            <div className="w-head">
                <span>Steward · suggested context</span>
                <span>ranked from your request</span>
            </div>

            {onContinue === undefined ? null : (
                <>
                    <p className="sg-sec">Continue where you left off</p>
                    <button type="button" className="sug" onClick={onContinue} disabled={busy}>
                        <span className="s-n">{continueLabel ?? 'Active draft'}</span>
                        <span className="w-meta">open →</span>
                    </button>
                </>
            )}

            <SuggestionList
                heading="Looks like this document type"
                items={documentTypes}
                selectedId={selection.documentTypeId}
                label={item => item.name}
                onPick={id => onPick({ documentTypeId: id })}
                busy={busy}
            />

            <SuggestionList
                heading="Who is it for?"
                items={funders}
                selectedId={selection.funderId}
                label={item => item.name}
                onPick={id => onPick({ funderId: id, dealId: '' })}
                busy={busy}
            />

            <SuggestionList
                heading="Related opportunities"
                items={opportunities}
                selectedId={selection.dealId}
                label={item => item.title}
                onPick={id => onPick({ dealId: id })}
                busy={busy}
            />
        </section>
    );
}
