import { useState } from 'react';

import type { OpportunityOption, Selection, Variant, Workspace } from '../types';

interface Props {
    workspace: Workspace;
    selection: Selection;
    onSelect: (patch: Partial<Selection>) => void;
    opportunities: OpportunityOption[];
    opportunitiesState: 'idle' | 'loading' | 'error';
    request: string;
    onRequest: (value: string) => void;
    wordLimit: number;
    onWordLimit: (value: number) => void;
    variant: Variant;
    onVariant: (value: Variant) => void;
    busy: boolean;
    generateLabel: string;
    onGenerate: () => void;
    onSendToChat: () => void;
}

/**
 * Scenario B1 — everything the user can work with, as pills rather than selects.
 *
 * The prototype's flat opportunity list is loaded per funder here: opportunities
 * belong to a funder in the backend (`GET /platform/funders/:id/deals`), the
 * extension loads them the same way, and the full deal graph is far larger than
 * one draft needs.
 */
export function ContextPicker({
    workspace,
    selection,
    onSelect,
    opportunities,
    opportunitiesState,
    request,
    onRequest,
    wordLimit,
    onWordLimit,
    variant,
    onVariant,
    busy,
    generateLabel,
    onGenerate,
    onSendToChat,
}: Props) {
    const [funderQuery, setFunderQuery] = useState('');
    const [opportunityQuery, setOpportunityQuery] = useState('');

    const documentType = workspace.documentTypes.find(type => type.id === selection.documentTypeId);
    const funder = workspace.funders.find(item => item.id === selection.funderId);

    const funders = workspace.funders.filter(item =>
        item.name.toLowerCase().includes(funderQuery.trim().toLowerCase()),
    );
    const deals = opportunities.filter(item =>
        item.title.toLowerCase().includes(opportunityQuery.trim().toLowerCase()),
    );

    const ready = documentType !== undefined && funder !== undefined && request.trim() !== '';

    return (
        <section className="card">
            <div className="w-head">
                <span>Steward · context</span>
                <span>
                    {documentType?.name ?? 'no document type'} · {funder?.name ?? 'no funder'} ·{' '}
                    {selection.dealId === '' ? 'no opportunity' : '1 opportunity'}
                </span>
            </div>

            <p className="w-title">Document type</p>
            <div>
                {workspace.documentTypes.map(type => (
                    <button
                        key={type.id}
                        type="button"
                        className={`pill${type.id === selection.documentTypeId ? ' sel' : ''}`}
                        onClick={() => onSelect({ documentTypeId: type.id })}
                        disabled={busy}
                    >
                        {type.name}
                    </button>
                ))}
            </div>

            {/* The writing tips the extension buried in a settings panel, surfaced
                where they change what the user types. */}
            <ul className="tips">
                {(documentType?.tips ?? []).map(tip => (
                    <li key={tip}>{tip}</li>
                ))}
            </ul>

            <p className="w-title spaced">Funder</p>
            <input
                type="search"
                value={funderQuery}
                onChange={event => setFunderQuery(event.target.value)}
                placeholder="Search funders by name…"
                aria-label="Search funders"
            />
            <div>
                {funders.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={`pill${item.id === selection.funderId ? ' sel' : ''}`}
                        onClick={() => onSelect({ funderId: item.id, dealId: '' })}
                        disabled={busy}
                    >
                        {item.name}
                        {item.lastGrantAmount === undefined ? null : (
                            <span className="sub-l">{item.lastGrantAmount}</span>
                        )}
                    </button>
                ))}
                {funders.length === 0 ? <span className="w-meta">No funder matches that name.</span> : null}
            </div>

            <p className="w-title spaced">Opportunity</p>
            {selection.funderId === '' ? (
                <span className="w-meta">Pick a funder to see its opportunities.</span>
            ) : opportunitiesState === 'loading' ? (
                <span className="w-meta">Loading opportunities…</span>
            ) : opportunitiesState === 'error' ? (
                <span className="w-meta">Could not load opportunities for this funder.</span>
            ) : opportunities.length === 0 ? (
                <span className="w-meta">This funder has no linked opportunities.</span>
            ) : (
                <>
                    {opportunities.length > 4 ? (
                        <input
                            type="search"
                            value={opportunityQuery}
                            onChange={event => setOpportunityQuery(event.target.value)}
                            placeholder="Search opportunities by name…"
                            aria-label="Search opportunities"
                        />
                    ) : null}
                    <div>
                        <button
                            type="button"
                            className={`pill${selection.dealId === '' ? ' sel' : ''}`}
                            onClick={() => onSelect({ dealId: '' })}
                            disabled={busy}
                        >
                            None
                        </button>
                        {deals.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                className={`pill${item.id === selection.dealId ? ' sel' : ''}`}
                                onClick={() => onSelect({ dealId: item.id })}
                                disabled={busy}
                            >
                                {item.title}
                                {item.stage === undefined ? null : <span className="sub-l">{item.stage}</span>}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <p className="w-title spaced">What should it say?</p>
            <textarea
                value={request}
                onChange={event => onRequest(event.target.value)}
                placeholder="Thank her for the first gift and mention the county-government desk."
                aria-label="Request"
            />

            <div className="row" style={{ marginTop: 10 }}>
                <div className="field" style={{ maxWidth: 140 }}>
                    <label htmlFor="wordLimit">Word limit</label>
                    <input
                        id="wordLimit"
                        type="number"
                        min={50}
                        max={2000}
                        step={50}
                        value={wordLimit}
                        onChange={event => onWordLimit(Number(event.target.value))}
                    />
                </div>
                {/* A spike control, not a product one: variant A and B are the two
                    orchestration paths the reliability matrix compares. */}
                <div className="field">
                    <label htmlFor="variant">Orchestration</label>
                    <select
                        id="variant"
                        value={variant}
                        onChange={event => onVariant(event.target.value as Variant)}
                    >
                        <option value="conversation">B — conversation continuation</option>
                        <option value="ui-tool-call">A — UI tool call</option>
                    </select>
                </div>
            </div>

            <div className="w-bar">
                <button type="button" className="btn brand" onClick={onGenerate} disabled={busy || !ready}>
                    {generateLabel}
                </button>
                <button
                    type="button"
                    className="btn"
                    onClick={onSendToChat}
                    disabled={busy || documentType === undefined || funder === undefined}
                >
                    Send context to chat ↗
                </button>
                <span className="grow" />
                <span className="w-meta">
                    {ready ? 'the model writes, the panel shows the result' : 'document type, funder and request'}
                </span>
            </div>
        </section>
    );
}
