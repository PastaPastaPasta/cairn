// Pieces the form and live pages share: the group's sub-navigation, page states, the registration card and the link form.
import type { Seat } from '@cairn/contract';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { openSignIn } from '../ui/Account.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';
import { linkProTxOp, type Agreement, type BundleState, type GroupRecord } from './data.ts';
import { FindingList, Technical } from './ui.tsx';
import { useRegistrationCheck, type RegState } from './useRegistration.ts';
import type { RegistrationJudgement } from './verify.ts';

export function GroupTabs({ id }: { id: string }) {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');
  return (
    <nav className="group-tabs" aria-label="This group">
      <NavLink to={`/g/${id}`} end className={cls}>
        Group
      </NavLink>
      <NavLink to={`/g/${id}/form`} className={cls}>
        Form
      </NavLink>
      <NavLink to={`/g/${id}/live`} className={cls}>
        Live
      </NavLink>
    </nav>
  );
}

/** Loading, missing and error states of a group page; renders `children` only when the group is ready. */
export function GroupGate({ title, id, state, children }: { title: string; id: string; state: BundleState; children: ReactNode }) {
  const { registry } = useApp();
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title={title} />
        <NotOpenHere />
      </div>
    );
  if (state.status === 'ready') return <>{children}</>;
  return (
    <div className="page">
      <PageHead title={title} />
      <GroupTabs id={id} />
      {state.status === 'loading' ? (
        <p className="list-status muted" role="status">
          <span className="spinner" aria-hidden="true" /> Reading the group from Dash Platform…
        </p>
      ) : (
        <div className="empty-state" role={state.status === 'error' ? 'alert' : undefined}>
          <p>{state.status === 'missing' ? `There is no group ${id} on ${registry.label}.` : `The group could not be read: ${state.error}`}</p>
          <p>
            <Link to="/groups">See open groups</Link>
          </p>
        </div>
      )}
    </div>
  );
}

const STATE_CLASS: Record<RegistrationJudgement['state'], string> = { verified: 'ok', mismatch: 'stop', unproven: 'warn', unconfirmed: 'warn', 'not-found': 'stop' };
const TRUST: Record<string, string> = {
  'quorum-proof': 'ChainLocks proven from the pinned quorum checkpoint',
  'proof-of-work': 'block headers and proof of work from the pinned checkpoint',
  node: 'a ChainLock proven over the block headers above it',
};

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
            The terms are recomputed from the group and compared with every member’s approval on Dash Platform; the group’s own status is not used.
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
      <p className="small error" role="alert">
        The chain could not be read: {state.error}
      </p>
    );
  return null;
}

const HASH = /^[0-9a-fA-F]{64}$/;

/** M10: paste the ProTx hash, see it checked against the approvals, then link it (organizer: the group; member: their own seat). */
export function LinkRegistration({ rec, seats, agreement, onLinked }: { rec: GroupRecord; seats: readonly Seat[]; agreement: Agreement; onLinked(): void }) {
  const { registry } = useApp();
  const { session, write } = useAccount();
  const [hash, setHash] = useState('');
  const { state, check, reset } = useRegistrationCheck(agreement);
  const action = useAction();
  const [done, setDone] = useState(false);
  const clean = hash.trim().toLowerCase();
  const me = session?.identityId;
  const canWrite = !!me && (rec.group.ownerId === me || seats.some((s) => s.ownerId === me && rec.group.roster.some((r) => r.id === me)));
  const result = state.status === 'done' ? state.results[0] : null;
  const linkable = result && (result.state === 'verified' || result.state === 'unproven' || result.state === 'unconfirmed');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (HASH.test(clean)) {
      setDone(false);
      check(clean);
    }
  };
  const link = () =>
    action.run(async () => {
      const op = linkProTxOp(registry, rec, seats, me!, clean);
      if (!op) throw new Error('Only the organizer or a co-owner with a seat can link the registration.');
      await write(op);
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
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={link} disabled={action.busy} data-testid="link-button">
              {action.busy ? 'Linking…' : rec.group.ownerId === me ? 'Link it to this group' : 'Link it from my seat'}
            </button>
          ) : session ? (
            <p className="small muted">Only the organizer or a co-owner can link it.</p>
          ) : (
            <button type="button" className="btn btn-primary" onClick={openSignIn}>
              Sign in to link it
            </button>
          )}
          {action.error && (
            <p className="small error" role="alert">
              {action.error}
            </p>
          )}
        </div>
      )}
      {done && (
        <p className="notice-ok small" role="status">
          Linked. Everyone now sees it on the <Link to={`/g/${rec.group.id}/live`}>live page</Link>, checked again from the chain on every visit.
        </p>
      )}
    </div>
  );
}
