// Who is in: the roster with names, amounts, states and contacts; the seat requests waiting for the organizer. A share counts only
// when the member's seat and the organizer's roster agree (S1); the organizer adds, updates and removes from here.
import { SEAT_STATUS } from '@cairn/contract';
import { useState } from 'react';
import type { Person } from '../../data/people.ts';
import { acceptSeat, fitsAsChange, removeShare, setShareAmount, type GroupView, type ShareRow } from '../../matching/group.ts';
import { dash } from '../../matching/money.ts';
import { seatOffers } from '../../matching/nextstep.ts';
import { WriteStatus } from '../../ui/Loaded.tsx';
import { ContactList, PersonName } from '../../ui/Person.tsx';
import { useAction } from '../../ui/useAction.ts';
import { OPEN, WITHDRAWN, type GroupOps } from './ops.ts';
import { SeatForm } from './NextStep.tsx';

const STATE_WORDS: Record<ShareRow['state'], string> = {
  confirmed: 'Confirmed',
  'awaiting-seat': 'Waiting for their seat',
  'amount-changed': 'Asked to change',
  withdrawn: 'Withdrew',
};

function ApprovalTag({ s }: { s: ShareRow }) {
  if (s.approval === 'none') return null;
  if (s.approval === 'approved')
    return (
      <span className="state state-ok" data-testid="approval-ok">
        ✓ Approved
      </span>
    );
  if (s.approval === 'mismatch')
    return (
      <span className="state state-bad" data-testid="approval-bad">
        ✗ Approval does not match
      </span>
    );
  return <span className="state state-wait">Not approved yet</span>;
}

export function Roster({ view, people, me, ops, done }: { view: GroupView; people: Map<string, Person>; me: string | null; ops: GroupOps; done(): void }) {
  const g = view.group;
  const organizer = me === g.ownerId;
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const act = (f: () => Promise<unknown>) => run(async () => {
    await f();
    done();
  });
  const roleTags = (id: string) => [id === g.ownerId && 'organizer', id === g.operatorId && 'operator', id === g.coordinatorId && 'coordinator', id === g.votingHolderId && 'voting key'].filter(Boolean) as string[];
  const mine = me ? view.shares.find((s) => s.id === me) : undefined;
  return (
    <section className="section" id="roster" aria-labelledby="roster-title">
      <h2 id="roster-title">Who is in</h2>
      {view.shares.length === 0 ? (
        <p className="muted">Nobody yet. {view.openAmounts ? 'The first seats are open.' : 'The organizer invites people who are looking.'}</p>
      ) : (
        <ul className="roster" data-testid="roster">
          {view.shares.map((s) => {
            const change = s.state === 'amount-changed' ? fitsAsChange(g, s.id, s.seat!.amount) : null;
            const offers = seatOffers(s.seat?.flags);
            return (
              <li key={s.id} className={`roster-row${s.id === me ? ' mine' : ''}`} data-state={s.state}>
                <div className="roster-who">
                  <PersonName id={s.id} person={people.get(s.id)} you={s.id === me} />
                  {s.label && <span className="label-chip mono-ish" title="Row label in Dash-Qt">{s.label}</span>}
                  {roleTags(s.id).map((t) => (
                    <span key={t} className="role-tag">
                      {t}
                    </span>
                  ))}
                  <div className="small">{people.get(s.id)?.profile ? <ContactList contacts={people.get(s.id)!.profile!.contacts} /> : null}</div>
                </div>
                <div className="roster-amount num">{dash(s.amount)}</div>
                <div className="roster-state">
                  <span className={`state state-${s.state === 'confirmed' ? 'ok' : s.state === 'awaiting-seat' ? 'wait' : 'warn'}`}>
                    {STATE_WORDS[s.state]}
                    {s.state === 'amount-changed' ? ` to ${dash(s.seat!.amount)}` : ''}
                  </span>
                  <ApprovalTag s={s} />
                  {!view.locked && (offers.coordinate || offers.holdKey) && (
                    <span className="small muted block">{[offers.coordinate && 'can coordinate', offers.holdKey && 'can hold the voting key'].filter(Boolean).join(', ')}</span>
                  )}
                </div>
                {organizer && !view.closed && (s.state !== 'confirmed' || !view.locked) && (
                  <div className="roster-actions">
                    {s.state === 'amount-changed' && (
                      <button type="button" className="btn btn-s" disabled={busy || !change!.ok} title={change!.ok ? undefined : change!.message} onClick={() => act(() => ops.group(setShareAmount(g, s.id, s.seat!.amount)))}>
                        Use {dash(s.seat!.amount)}
                      </button>
                    )}
                    {s.id !== g.ownerId && (
                      <button type="button" className="btn btn-s btn-quiet" disabled={busy} onClick={() => act(() => ops.group(removeShare(g, s.id)))} aria-label={`Remove ${people.get(s.id)?.name ?? 'this member'} from the roster`}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {organizer && view.locked && <p className="small muted">The terms are locked. Changing the roster unlocks them and voids every approval.</p>}
      <WriteStatus busy={busy} error={error} />
      {mine && mine.state === 'confirmed' && !view.locked && (
        <details className="my-seat" open={editing} onToggle={(e) => setEditing((e.target as HTMLDetailsElement).open)}>
          <summary>Change my seat</summary>
          <SeatForm view={view} ops={ops} me={me!} done={done} mode="manage" />
        </details>
      )}
      <Requests view={view} people={people} organizer={organizer} ops={ops} done={done} me={me} />
    </section>
  );
}

function Requests({ view, people, organizer, ops, done, me }: { view: GroupView; people: Map<string, Person>; organizer: boolean; ops: GroupOps; done(): void; me: string | null }) {
  const g = view.group;
  const { busy, error, run } = useAction();
  const [showDeclined, setShowDeclined] = useState(false);
  if (!view.requests.length) return null;
  const open = view.requests.filter((r) => !r.declined);
  const declined = view.requests.filter((r) => r.declined);
  const act = (f: () => Promise<unknown>) => run(async () => {
    await f();
    done();
  });
  const list = (rows: typeof view.requests) => (
    <ul className="requests">
      {rows.map((r) => {
        const offers = seatOffers(r.seat.flags);
        return (
          <li key={r.seat.id} className="request-row" data-testid="request">
            <div>
              <PersonName id={r.seat.ownerId} person={people.get(r.seat.ownerId)} you={r.seat.ownerId === me} /> <span className="num">{dash(r.seat.amount)}</span>
              {r.invite?.status === OPEN && <span className="role-tag">invited</span>}
              {r.seat.message && <p className="quote small">{r.seat.message}</p>}
              <p className="small muted">
                {[offers.coordinate && 'Can coordinate', offers.holdKey && 'can hold the voting key'].filter(Boolean).join(', ')}
                {!r.fit.ok && <span className="field-problem"> {r.fit.message}</span>}
              </p>
              {people.get(r.seat.ownerId)?.profile && <ContactList contacts={people.get(r.seat.ownerId)!.profile!.contacts} />}
            </div>
            {organizer && !view.closed && (
              <div className="form-actions">
                <button type="button" className="btn btn-s btn-primary" disabled={busy || !r.fit.ok} onClick={() => act(() => ops.group(acceptSeat(g, r.seat)))} data-testid="request-accept">
                  Add to roster
                </button>
                {!r.declined && (
                  <button type="button" className="btn btn-s" disabled={busy} onClick={() => act(() => ops.invite(r.seat.ownerId, r.seat.amount, WITHDRAWN, 'Request declined'))} data-testid="request-decline">
                    Decline
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="requests-block" id="requests">
      <h3>
        Asking for a seat <span className="count">{open.length}</span>
      </h3>
      {open.length ? list(open) : <p className="small muted">No open requests.</p>}
      {view.locked && organizer && open.length > 0 && <p className="small muted">Adding someone unlocks the terms and voids every approval.</p>}
      {declined.length > 0 && (
        <p>
          <button type="button" className="btn btn-quiet btn-s" aria-expanded={showDeclined} onClick={() => setShowDeclined((x) => !x)}>
            {showDeclined ? 'Hide' : 'Show'} {declined.length} declined
          </button>
        </p>
      )}
      {showDeclined && list(declined)}
      <WriteStatus busy={busy} error={error} />
      {view.declined.length > 0 && <p className="small muted">{view.declined.length === 1 ? 'One person' : `${view.declined.length} people`} declined or withdrew.</p>}
    </div>
  );
}

export const isRequested = (s: number) => s === SEAT_STATUS.requested;
