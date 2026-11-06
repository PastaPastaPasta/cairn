// Pieces the group's pages share: the group's sub-navigation, page states, the registration card and the link form.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import type { Load } from '../data/cairn.ts';
import type { GroupBundle, GroupView } from '../matching/group.ts';
import type { GroupOps } from '../pages/group/ops.ts';
import { openSignIn } from '../ui/Account.tsx';
import { ErrorDetail, WriteStatus } from '../ui/Loaded.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';
import { FindingList, Technical } from './ui.tsx';
import { keyPublishedAtOf, useRegistrationCheck, type RegState } from './useRegistration.ts';
import type { RegistrationJudgement } from './verify.ts';

/**
 * The group's pages: matching and terms, forming, the live masternode, and the message checker against its approved terms.
 * `linked: false` (the group is known to have no registration yet) shows Live as not there yet, instead of an empty page.
 */
export function GroupTabs({ id, linked }: { id: string; linked?: boolean }) {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');
  const onLive = useLocation().pathname === `/g/${id}/live`;
  return (
    <nav className="group-tabs" aria-label="This group">
      <NavLink to={`/g/${id}`} end className={cls}>
        Group
      </NavLink>
      <NavLink to={`/g/${id}/form`} className={cls}>
        Form
      </NavLink>
      {linked === false && !onLive ? (
        <span className="tab-later" aria-disabled="true" title="The live page opens once a registration is linked" data-testid="tab-live-later">
          Live · after forming
        </span>
      ) : (
        <NavLink to={`/g/${id}/live`} className={cls}>
          Live
        </NavLink>
      )}
      <NavLink to={`/check?group=${id}`} className={cls}>
        Check a message
      </NavLink>
    </nav>
  );
}

/** Loading, missing and error states of a group page; renders `children` with the group once it is read. */
/** Someone changed the group while this page was open; the page re-read it. */
export function GroupUpdated() {
  return (
    <p className="notice-box small" role="status" data-testid="group-updated">
      This group changed since you opened the page. You are now seeing the latest version.
    </p>
  );
}

export function GroupGate({ title, id, load, children }: { title: string; id: string; load: Load<GroupBundle | null> & { updated?: boolean; reload?(): void }; children(bundle: GroupBundle): ReactNode }) {
  const { registry } = useApp();
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title={title} />
        <NotOpenHere />
      </div>
    );
  if (load.status === 'ready' && load.data)
    return (
      <>
        {children(load.data)}
        {(load.refreshing || load.updated) && (
          <div className="page-toast">
            {load.refreshing ? (
              <p className="small" role="status">
                <span className="spinner" aria-hidden="true" /> Updating…
              </p>
            ) : (
              <GroupUpdated />
            )}
          </div>
        )}
      </>
    );
  return (
    <div className="page">
      <PageHead title={title} />
      <GroupTabs id={id} />
      {load.status === 'loading' ? (
        <p className="list-status muted" role="status">
          <span className="spinner" aria-hidden="true" /> Reading the group from Dash Platform…
        </p>
      ) : (
        <div className="empty-state" role={load.status === 'error' ? 'alert' : undefined}>
          <p>{load.status === 'error' ? `The group could not be read. ${load.error}` : `There is no group with this link on ${registry.label}.`}</p>
          {load.status === 'error' && <ErrorDetail detail={load.detail} />}
          {load.status === 'error' && load.reload && (
            <button type="button" className="btn btn-s" onClick={load.reload}>
              Try again
            </button>
          )}
          <p>
            <Link to="/groups">See open groups</Link>
          </p>
        </div>
      )}
    </div>
  );
}

const STATE_CLASS: Record<RegistrationJudgement['state'], string> = { verified: 'ok', 'recorded-after': 'neutral', mismatch: 'stop', unproven: 'warn', unconfirmed: 'warn', 'not-found': 'stop' };
const TRUST: Record<string, string> = {
  'quorum-proof': 'ChainLocks proven from the pinned quorum checkpoint',
  'proof-of-work': 'block headers and proof of work from the pinned checkpoint',
  node: 'a ChainLock proven over the block headers above it',
};
const when = (ms: number | undefined) => (ms === undefined ? 'unknown' : new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');

export function RegistrationCard({ j, compact = false }: { j: RegistrationJudgement; compact?: boolean }) {
  const f = j.facts;
  return (
    <div className={`reg-card reg-${STATE_CLASS[j.state]}`} data-testid="registration" data-state={j.state}>
      <p className="reg-headline">
        <span className="reg-dot" aria-hidden="true" />
        {j.headline}
      </p>
      <p className="reg-detail">{j.detail}</p>
      {j.problems.length > 0 && (
        <>
          <p className="reg-diff-title">What differs</p>
          <ul className="reg-diff" data-testid="registration-problems">
            {j.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
      {!compact && (
        <Technical title="How this was checked">
          <p className="small">
            ProTx <span className="num break">{j.proTxHash}</span>
          </p>
          {f && f.height > 0 && (
            <p className="small">
              Proven into block {f.height.toLocaleString('en-US')} by its merkle root; the chain it rests on is verified with {TRUST[f.trust] ?? f.trust}
              {f.weak ? ` (${f.weak})` : ''}. The masternode list is {f.listTrust === 'proven' ? 'proven against the same chain' : f.listTrust === 'agreed' ? 'the one several nodes agreed on' : 'unavailable'}.
            </p>
          )}
          <p className="small">
            The terms are recomputed from the group and compared with every member’s approval on Dash Platform; the group’s own status is not used. It counts as
            verified only when every approval, and the operator’s key on Cairn, are older than the registration’s block
            {f?.blockTime ? ` (${when(f.blockTime * 1000)})` : ''}.
          </p>
          {j.check && <FindingList findings={j.check.findings} />}
        </Technical>
      )}
    </div>
  );
}

export function RegProgress({ state }: { state: RegState }) {
  if (state.status === 'checking')
    return (
      <p className="small muted" role="status" data-testid="registration-progress">
        <span className="spinner" aria-hidden="true" /> {state.progress}
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert">
        <p className="small error">The chain could not be read. {state.error}</p>
        <ErrorDetail detail={state.detail} />
      </div>
    );
  return null;
}

const HASH = /^[0-9a-fA-F]{64}$/;

/** M10: paste the ProTx hash, see it checked against the approvals, then link it (organizer: the group; member: their own seat). */
export function LinkRegistration({ view, ops, onLinked }: { view: GroupView; ops: GroupOps; onLinked(): void }) {
  const { session } = useAccount();
  const [hash, setHash] = useState('');
  const { state, check, reset } = useRegistrationCheck(view.agreement, keyPublishedAtOf(view));
  const action = useAction();
  const [done, setDone] = useState(false);
  const clean = hash.trim().toLowerCase();
  const g = view.group;
  const result = state.status === 'done' ? state.results[0] : null;
  const linkable = result && (result.state === 'verified' || result.state === 'recorded-after' || result.state === 'unproven' || result.state === 'unconfirmed');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (HASH.test(clean)) {
      setDone(false);
      check(clean);
    }
  };
  const link = () =>
    action.run(async () => {
      await ops.linkRegistration(clean);
      setDone(true);
      onLinked();
    });
  return (
    <div className="link-reg" data-testid="link-registration">
      <form className="link-form" onSubmit={submit}>
        <label htmlFor="protx-hash">ProTx hash</label>
        <div className="link-row">
          <input
            id="protx-hash"
            className="num"
            spellCheck={false}
            autoComplete="off"
            placeholder="64 hex characters, from Dash-Qt’s “Shared masternode registered” page"
            value={hash}
            onChange={(e) => (setHash(e.target.value), reset(), setDone(false))}
          />
          <button type="submit" className="btn" disabled={!HASH.test(clean) || state.status === 'checking'}>
            Check it
          </button>
        </div>
        {hash && !HASH.test(clean) && <p className="small error">A ProTx hash is 64 hexadecimal characters.</p>}
      </form>
      <RegProgress state={state} />
      {result && <RegistrationCard j={result} />}
      {linkable && !done && (
        <div className="form-actions">
          {ops.canLink ? (
            <button type="button" className="btn btn-primary" onClick={link} disabled={action.busy} data-testid="link-button">
              {action.busy ? 'Linking…' : g.ownerId === session?.identityId ? 'Link it to this group' : 'Link it from my seat'}
            </button>
          ) : session ? (
            <p className="small muted">Only the organizer or a co-owner can link it.</p>
          ) : (
            <button type="button" className="btn btn-primary" onClick={openSignIn}>
              Sign in to link it
            </button>
          )}
          <WriteStatus busy={false} error={action.error} detail={action.detail} />
        </div>
      )}
      {done && (
        <p className="notice-ok small" role="status">
          Linked. Everyone now sees it on the <Link to={`/g/${g.id}/live`}>live page</Link>, checked again from the chain on every visit.
        </p>
      )}
    </div>
  );
}
