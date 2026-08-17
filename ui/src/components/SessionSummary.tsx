import type { SessionState } from '../types';

interface Props {
    session: SessionState;
    documentTypeName: string | undefined;
    funderName: string | undefined;
    opportunityTitle: string | undefined;
}

/**
 * Scenario B2 — what this session is, at a glance.
 *
 * The same three facts the walkthrough shows when a user comes back the next day
 * and asks where they left off: what is being written and for whom, how many
 * versions exist, and what has happened to them.
 */
export function SessionSummary({ session, documentTypeName, funderName, opportunityTitle }: Props) {
    const edits = session.versions.filter(version => version.source === 'user').length;
    const latest = session.versions.at(-1);

    return (
        <section className="card">
            <div className="w-head">
                <span>Active session</span>
                <span>
                    {session.sessionId.slice(0, 8)}… · updated{' '}
                    {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
            <div className="mini-cards">
                <div className="mini">
                    <div className="m-t">{documentTypeName ?? 'Document'}</div>
                    <div className="m-s">
                        {funderName ?? 'no funder'}
                        {opportunityTitle === undefined ? '' : ` · ${opportunityTitle}`}
                    </div>
                </div>
                <div className="mini">
                    <div className="m-t">
                        {session.versionCount} version{session.versionCount === 1 ? '' : 's'}
                    </div>
                    <div className="m-s">
                        {latest === undefined
                            ? 'nothing written yet'
                            : latest.source === 'user'
                              ? 'latest is your manual edit'
                              : 'latest is the model’s draft'}
                    </div>
                </div>
                <div className="mini">
                    <div className="m-t">
                        {session.eventCount} event{session.eventCount === 1 ? '' : 's'}
                    </div>
                    <div className="m-s">
                        {edits} edit{edits === 1 ? '' : 's'} ·{' '}
                        {session.versions.filter(version => version.feedback !== undefined).length} rated ·{' '}
                        {session.versions.reduce((total, version) => total + version.copyCount, 0)} copied
                    </div>
                </div>
            </div>
        </section>
    );
}
