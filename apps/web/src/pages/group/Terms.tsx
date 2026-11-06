// The group's terms in plain words (operator, reward, leaving early, coordinator, voting key, chat), and once locked the term sheet
// every member approves (M8), with each approval checked against the hash recomputed from the group document.
import { OP_ACCEPT_STATUS } from '@cairn/contract';
import { canonicalize } from '@cairn/shares';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Person } from '../../data/people.ts';
import { formByDate, formByPassed } from '../../matching/deadline.ts';
import { exitWords, termWarnings } from '../../matching/exit.ts';
import type { GroupView } from '../../matching/group.ts';
import { dash, pct } from '../../matching/money.ts';
import { Warnings } from '../../ui/fields.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { WriteStatus } from '../../ui/Loaded.tsx';
import { PersonName } from '../../ui/Person.tsx';
import { useAction } from '../../ui/useAction.ts';
import type { GroupOps } from './ops.ts';

const who = (id: string | undefined | null, people: Map<string, Person>, me: string | null, none = 'Not chosen yet') =>
  id ? <PersonName id={id} person={people.get(id)} you={id === me} /> : <span className="muted">{none}</span>;

export function Terms({ view, people, me }: { view: GroupView; people: Map<string, Person>; me: string | null }) {
  const g = view.group;
  const answer = view.operatorAnswer;
  return (
    <section className="section" aria-labelledby="terms-title">
      <h2 id="terms-title">Terms</h2>
      <dl className="facts">
        <dt>Operator</dt>
        <dd>
          {g.operatorId ? (
            <>
              <Link to={`/operators/${g.operatorId}`}>{people.get(g.operatorId)?.name ?? 'Operator profile'}</Link>
              {view.operatorLed ? <span className="small muted"> · opened this group</span> : answer?.status === OP_ACCEPT_STATUS.accepted ? <span className="state state-ok">Accepted</span> : answer?.status === OP_ACCEPT_STATUS.declined ? <span className="state state-bad">Declined</span> : <span className="state state-wait">Has not answered</span>}
            </>
          ) : (
            <span className="muted">To be chosen</span>
          )}
        </dd>
        <dt>Operator reward</dt>
        <dd>
          {pct(g.rewardBps)} of every masternode payment; the rest is split by share.
        </dd>
        <dt>Leaving early</dt>
        <dd>{exitWords(g.earlyPeriodBlocks, g.earlyPenalty)}</dd>
        <dt>Coordinator</dt>
        <dd>{who(g.coordinatorId, people, me)}</dd>
        <dt>Voting key</dt>
        <dd>
          {who(g.votingHolderId, people, me)}
          {g.votingPolicy && <span className="small block">{g.votingPolicy}</span>}
        </dd>
        <dt>Seats</dt>
        <dd>{view.openAmounts ? 'Anyone can ask for an amount that fits.' : 'By invitation.'}</dd>
        {g.formBy && (
          <>
            <dt>Aim to form by</dt>
            <dd>
              {formByDate(g.formBy)}
              {formByPassed(view) && <span className="small muted"> (passed)</span>}
            </dd>
          </>
        )}
        <dt>Group chat</dt>
        <dd>
          {g.chatUrl ? (
            <a href={g.chatUrl} rel="noopener noreferrer nofollow" target="_blank">
              {new URL(g.chatUrl).host}
            </a>
          ) : (
            <span className="muted">No link yet</span>
          )}
        </dd>
      </dl>
      <Warnings items={termWarnings(g)} />
    </section>
  );
}

/** `formed`: a registration is linked (or the masternode dissolved), so readiness to form is history and is not shown. */
export function TermSheetSection({ view, people, me, ops, done, formed = false }: { view: GroupView; people: Map<string, Person>; me: string | null; ops: GroupOps; done(): void; formed?: boolean }) {
  const g = view.group;
  const sheet = view.sheet!;
  const mine = me ? view.shares.find((s) => s.id === me) : undefined;
  const [read, setRead] = useState(false);
  // a new revision or a withdrawn approval asks for a fresh reading
  useEffect(() => setRead(false), [view.hash, mine?.approval]);
  const { busy, error, run } = useAction();
  const approve = () =>
    run(async () => {
      if (!view.hash) throw new Error('These terms cannot be approved: they are not a valid term sheet.');
      await ops.approve(view.hash, mine!.amount);
      done();
    });
  const reapprove = () =>
    run(async () => {
      await ops.withdrawApproval();
      if (view.hash && mine?.approval === 'mismatch') await ops.approve(view.hash, mine.amount);
      done();
    });
  return (
    <section className="section term-sheet" id="terms" aria-labelledby="sheet-title" data-testid="term-sheet">
      <h2 id="sheet-title">The locked terms</h2>
      <p className="lede-s">
        Revision {g.termsRevision}. This is what each co-owner approves, and what every Dash Core message is later checked against. Your addresses are not here: you enter them in Dash Core.
      </p>
      <div className={`hash-check ${view.hashOk ? 'ok' : 'bad'}`} role={view.hashOk ? undefined : 'alert'} data-testid="hash-check">
        {view.hashOk
          ? 'Checked: the terms below are exactly what the organizer locked.'
          : view.sheetIssues.length
            ? `These terms are not valid: ${view.sheetIssues.map((i) => i.message).join(' ')}`
            : 'Warning: the terms below do not match what the organizer locked. Do not approve; ask the organizer to lock again.'}
      </div>
      <table className="sheet-table">
        <caption className="visually-hidden">Shares</caption>
        <thead>
          <tr>
            <th scope="col">Label in Dash-Qt</th>
            <th scope="col">Co-owner</th>
            <th scope="col" className="num-col">
              Share
            </th>
            <th scope="col">Approval</th>
          </tr>
        </thead>
        <tbody>
          {view.shares.map((s) => (
            <tr key={s.id} className={s.id === me ? 'mine' : undefined}>
              <td className="mono-ish">{s.label}</td>
              <td>
                <PersonName id={s.id} person={people.get(s.id)} you={s.id === me} />
              </td>
              <td className="num num-col">{dash(s.amount)}</td>
              <td>
                {s.approval === 'approved' ? (
                  <span className="state state-ok">
                    <Icon name="check" size={12} /> Approved
                  </span>
                ) : s.approval === 'mismatch' ? (
                  <span className="state state-bad">
                    <Icon name="x" size={12} /> Does not match
                  </span>
                ) : (
                  <span className="state state-wait">Waiting</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="facts">
        <dt>Operator</dt>
        <dd>{g.operatorId ? <PersonName id={g.operatorId} person={people.get(g.operatorId)} you={g.operatorId === me} /> : null} takes {pct(g.rewardBps)}, fixed for this masternode.</dd>
        <dt>Node address</dt>
        <dd className="mono-ish">{sheet.service || <span className="muted">Set later by the operator</span>}</dd>
        <dt>Leaving early</dt>
        <dd>{exitWords(g.earlyPeriodBlocks, g.earlyPenalty)}</dd>
        <dt>Coordinator</dt>
        <dd>{g.coordinatorId && <PersonName id={g.coordinatorId} person={people.get(g.coordinatorId)} you={g.coordinatorId === me} />} starts the masternode in Dash-Qt and pays the small network fee.</dd>
        <dt>Voting key</dt>
        <dd>
          {g.votingHolderId && <PersonName id={g.votingHolderId} person={people.get(g.votingHolderId)} you={g.votingHolderId === me} />} holds it: <span className="mono-ish break">{sheet.votingAddress}</span>
        </dd>
      </dl>
      <details className="tech">
        <summary>Technical details</summary>
        <p className="small">Term sheet hash, recomputed in your browser from the group record:</p>
        <p className="mono-ish break small" data-testid="terms-hash">
          {view.hash ?? 'none (the terms are not a valid term sheet)'}
        </p>
        <p className="small">Hash the organizer locked:</p>
        <p className="mono-ish break small">{g.lockedHash}</p>
        <p className="small">BLS operator public key:</p>
        <p className="mono-ish break small">{sheet.operatorPubKey}</p>
        <p className="small">Canonical term sheet (sha256 of “cairn-terms-v1” and this):</p>
        <pre className="canonical">{canonicalize(sheet)}</pre>
      </details>
      {mine && formed && (
        <p className="small muted" data-testid="approval-kept">
          The masternode is registered, so your approval stays as the record the chain is checked against. To leave, dissolve in Dash-Qt (see the live page).
        </p>
      )}
      {mine && !formed && (
        <div className="approve-box" data-testid="approve-box">
          {mine.approval === 'approved' ? (
            <>
              <p className="notice-ok">You approved these terms for your {dash(mine.amount)} share, labelled “{mine.label}”.</p>
              <button type="button" className="btn btn-s btn-quiet" disabled={busy} onClick={() => run(async () => { await ops.withdrawApproval(); done(); })}>
                Withdraw my approval
              </button>
            </>
          ) : mine.approval === 'mismatch' ? (
            <>
              <p className="error">Your approval is for different terms or a different amount than these.</p>
              <button type="button" className="btn btn-primary" disabled={busy || !view.hashOk} onClick={reapprove} data-testid="reapprove">
                Withdraw it and approve these terms
              </button>
            </>
          ) : (
            <>
              <label className="check">
                <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} data-testid="approve-read" />
                <span>
                  I read these terms. I will bring <b>{dash(mine.amount)}</b> as “{mine.label}”, and I will only sign in Dash Core what matches them.
                </span>
              </label>
              <button type="button" className="btn btn-primary" disabled={busy || !read || !view.hashOk || mine.state !== 'confirmed'} onClick={approve} data-testid="approve">
                Approve the terms
              </button>
              <p className="small muted">Your approval is a record on Dash Platform with the hash of these terms. It costs about 0.0005 DASH of credit.</p>
            </>
          )}
          <WriteStatus busy={busy} error={error} />
        </div>
      )}
      {formed ? null : view.ready ? (
        <div className="ready-banner" data-testid="ready">
          <p>
            <b>Ready to form.</b> Every co-owner approved these exact terms.
          </p>
          <Link className="btn btn-primary" to={`/g/${g.id}/form`}>
            Next: form it in Dash Core →
          </Link>
        </div>
      ) : (
        view.waitingFor.length > 0 && (
          <ul className="waiting small" data-testid="waiting-for">
            {view.waitingFor.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
