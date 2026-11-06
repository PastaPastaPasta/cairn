// /g/:id: one group. Its cairn made of the real shares, the roster, the terms, and one clear next step per role the viewer has
// (DESIGN M7). Members request, change and withdraw seats (M5); the organizer accepts into the roster (S1), invites, locks (S3);
// the operator of a member-led group answers and gives their key (O3, O4); members approve the locked term sheet (M8).
import { GROUP_STATUS } from '@cairn/contract';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from '../../app/account.tsx';
import { useApp } from '../../app/context.tsx';
import { loadGroupBundle, useLoad } from '../../data/cairn.ts';
import { usePeople } from '../../data/people.ts';
import { groupView, type GroupBundle, type GroupView } from '../../matching/group.ts';
import { DUFFS, dash, shortId } from '../../matching/money.ts';
import { nextSteps } from '../../matching/nextstep.ts';
import { GROUP_STATUS_WORDS } from '../../matching/words.ts';
import { CairnStack, type Stone } from '../../ui/CairnStack.tsx';
import { Loaded } from '../../ui/Loaded.tsx';
import { NotOpenHere, PageHead } from '../../ui/states.tsx';
import { NextSteps } from './NextStep.tsx';
import { useGroupOps } from './ops.ts';
import { EditTerms, InviteSection, LockSection, OperatorSection, RefillPanel } from './Organizer.tsx';
import { Roster } from './Roster.tsx';
import { useMyOperator } from '../me/OperatorEditor.tsx';
import { TermSheetSection, Terms } from './Terms.tsx';
import '../../styles/matching.css';

export function GroupPage() {
  const { id = '' } = useParams();
  const { registry } = useApp();
  const load = useLoad(`group:${id}`, (r) => loadGroupBundle(r, id));
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title="Group" />
        <NotOpenHere />
      </div>
    );
  return (
    <div className="page group-page">
      <Loaded load={load} retry={load.reload} what="Reading this group from Dash Platform…">
        {(b) =>
          b ? (
            <GroupBody bundle={b} reload={load.reload} refreshing={load.status === 'ready' && load.refreshing} />
          ) : (
            <>
              <PageHead title={`Group ${shortId(id)}`} />
              <div className="empty-state">
                <p>
                  <b>No group with this id on {registry.label}.</b> It may have been deleted, or the link is for the other network.
                </p>
                <p>
                  <Link to="/groups">See open groups</Link>
                </p>
              </div>
            </>
          )
        }
      </Loaded>
    </div>
  );
}

/** The stones of the cairn: counted shares by state, then requests and roster entries still waiting for a seat. */
export function stonesOf(view: GroupView, me: string | null, nameOf: (id: string) => string | null): Stone[] {
  const stones: Stone[] = view.shares.map((s) => ({
    id: s.id,
    label: nameOf(s.id) ?? s.label ?? 'A co-owner',
    amount: s.amount / DUFFS,
    state: s.state !== 'confirmed' ? 'requested' : s.approval === 'approved' ? 'approved' : 'in',
    mine: s.id === me,
  }));
  for (const r of view.requests.filter((x) => !x.declined)) stones.push({ id: r.seat.ownerId, label: nameOf(r.seat.ownerId) ?? 'Someone', amount: r.seat.amount / DUFFS, state: 'requested', mine: r.seat.ownerId === me });
  return stones;
}

function statusLine(v: GroupView): { text: string; tone: string } {
  if (v.closed) return { text: GROUP_STATUS_WORDS[v.group.status] ?? 'Closed', tone: 'muted' };
  if (v.ready) return { text: 'Ready to form', tone: 'ok' };
  if (v.locked) return { text: v.hashOk ? `Terms locked · ${v.approvedCount} of ${v.shares.length} approved` : 'Locked terms do not match', tone: v.hashOk ? 'wait' : 'bad' };
  if (v.full) return { text: 'Full · agreeing terms', tone: 'wait' };
  return { text: v.remaining ? `${dash(v.remaining)} still open` : 'Shares complete · waiting for seats', tone: 'ok' };
}

function GroupBody({ bundle, reload, refreshing }: { bundle: GroupBundle; reload(): void; refreshing: boolean }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const me = session?.identityId ?? null;
  const view = useMemo(() => groupView(bundle, registry.network), [bundle, registry.network]);
  const g = view.group;
  const ids = useMemo(
    () => [g.ownerId, ...(g.operatorId ? [g.operatorId] : []), ...g.roster.map((r) => r.id), ...bundle.seats.map((s) => s.ownerId), ...bundle.invites.map((i) => i.toId), ...bundle.opAccepts.map((o) => o.ownerId)],
    [bundle, g],
  );
  const people = usePeople(ids);
  const myListing = useMyOperator(me);
  const steps = nextSteps(view, { id: me, isOperator: myListing.status === 'ready' && !!myListing.data });
  const ops = useGroupOps(bundle, me);
  const organizer = me === g.ownerId;
  const status = statusLine(view);
  const nameOf = (id: string) => people.get(id)?.name ?? null;
  return (
    <>
      <PageHead title={g.title} lede={g.about}>
        <p className="group-meta">
          <span className={`state state-${status.tone}`} data-testid="group-status">
            {status.text}
          </span>
          <span className="small muted">
            {view.operatorLed ? 'Opened by its operator' : 'Opened by a member'} · organizer <span className="person">{nameOf(g.ownerId) ?? shortId(g.ownerId)}</span>
            {g.refillOf && (
              <>
                {' '}
                · refill of <Link to={`/g/${g.refillOf}`}>an earlier group</Link>
              </>
            )}
          </span>
          {refreshing && (
            <span className="small muted" role="status">
              <span className="spinner" aria-hidden="true" /> Updating…
            </span>
          )}
        </p>
      </PageHead>
      {view.voided.length > 0 && !view.ready && (
        <p className="voided" role="note" data-testid="voided">
          {view.voided.length === 1 ? 'One approval' : `${view.voided.length} approvals`} of revision {g.revision - 1} no longer count: the terms changed after
          {view.voided.length === 1 ? ' it' : ' them'}. {view.locked ? 'Members approve revision ' + g.revision + ' again.' : 'Members approve again once the organizer locks the new terms.'}
        </p>
      )}
      <div className="group-top">
        <NextSteps view={view} steps={steps} ops={ops} me={me} done={reload} />
        <div className="group-cairn">
          <CairnStack stones={stonesOf(view, me, nameOf)} />
        </div>
      </div>
      <div className="group-main">
        <Roster view={view} people={people} me={me} ops={ops} done={reload} />
        {view.locked ? <TermSheetSection view={view} people={people} me={me} ops={ops} done={reload} /> : <Terms view={view} people={people} me={me} />}
        {organizer && !view.closed && (
          <>
            {view.remaining > 0 && !view.locked && <InviteSection view={view} people={people} ops={ops} done={reload} />}
            {!view.operatorLed && !view.locked && <OperatorSection view={view} people={people} ops={ops} done={reload} />}
            {(view.full || view.locked) && <LockSection view={view} people={people} ops={ops} done={reload} />}
            <EditTerms view={view} ops={ops} done={reload} />
          </>
        )}
        {me && g.status === GROUP_STATUS.dissolved && g.roster.some((r) => r.id === me) && <RefillPanel view={view} people={people} me={me} />}
        {view.locked && !view.ready && (
          <p className="small muted form-link">
            Formation opens here once everyone has approved: <Link to={`/g/${g.id}/form`}>Next: form it in Dash Core →</Link>
          </p>
        )}
      </div>
    </>
  );
}
