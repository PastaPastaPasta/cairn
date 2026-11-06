// /me: every group the signed-in identity is part of (organizer, co-owner, requester, invitee, operator), each with its next step.
// Found through the indexes the contract has for this (groups by owner and by operator, seats, invites and answers by owner);
// approvals come with each group (DESIGN §7: "my approvals" is a few queries per group, not an index).
import {
  GROUP_STATUS, INVITE_STATUS, groupsByStatus, groupsOfOperator, groupsOrganizedBy, invitesTo, opAcceptsOf, seatsOf, toGroup, toInvite, toOpAccept, toSeat,
} from '@cairn/contract';
import { Link } from 'react-router-dom';
import type { Registry } from '../../config/registry.ts';
import { loadGroupBundle, rawId, readAll, readNewest, useLoad } from '../../data/cairn.ts';
import { groupView, type GroupView } from '../../matching/group.ts';
import { DUFFS } from '../../matching/money.ts';
import { ROLE_WORDS, nextSteps, stepHref, type Step } from '../../matching/nextstep.ts';
import { CairnStack } from '../../ui/CairnStack.tsx';
import { Loaded } from '../../ui/Loaded.tsx';
import { stonesOf } from '../group/GroupPage.tsx';

const MAX_GROUPS = 24;

export interface MyGroup {
  view: GroupView;
  steps: Step[];
}

export async function loadMyGroups(r: Registry, me: string, isOperator: boolean): Promise<MyGroup[]> {
  const mine = (key: string) => (raw: Record<string, unknown>) => rawId(raw, key) === me;
  const [organized, seats, invites, answers, operated] = await Promise.all([
    readAll(r, 'group', (a) => groupsOrganizedBy(me, a), (d, n) => toGroup(d, n), mine('$ownerId')),
    readAll(r, 'seat', (a) => seatsOf(me, a), (d, n) => toSeat(d, n), mine('$ownerId')),
    readAll(r, 'invite', (a) => invitesTo(me, a), (d) => toInvite(d), mine('toId')),
    readAll(r, 'opAccept', (a) => opAcceptsOf(me, a), (d, n) => toOpAccept(d, n), mine('$ownerId')),
    readAll(r, 'group', (a) => groupsOfOperator(me, undefined, a), (d, n) => toGroup(d, n), mine('operatorId')),
  ]);
  const ids = [
    ...organized.map((g) => g.id),
    ...operated.map((g) => g.id),
    ...seats.map((s) => s.groupId),
    ...invites.filter((i) => i.status === INVITE_STATUS.open).map((i) => i.groupId),
    ...answers.map((a) => a.groupId),
  ];
  const unique = [...new Set(ids)].slice(0, MAX_GROUPS);
  const bundles = await Promise.all(unique.map((id) => loadGroupBundle(r, id).catch(() => null)));
  const order: Record<Step['tone'], number> = { todo: 0, warn: 1, wait: 2, done: 3 };
  return bundles
    .flatMap((b) => (b ? [b] : []))
    .map((b) => {
      const view = groupView(b, r.network);
      return { view, steps: nextSteps(view, { id: me, isOperator }).filter((s) => s.role !== 'visitor') };
    })
    .filter((g) => g.steps.length > 0)
    .sort((a, b) => Number(a.view.closed) - Number(b.view.closed) || Math.min(...a.steps.map((s) => order[s.tone])) - Math.min(...b.steps.map((s) => order[s.tone])) || (b.view.group.updatedAt ?? 0) - (a.view.group.updatedAt ?? 0));
}

export function MyGroups({ me, isOperator }: { me: string; isOperator: boolean }) {
  const load = useLoad(`my-groups:${me}:${isOperator}`, (r) => loadMyGroups(r, me, isOperator));
  return (
    <Loaded
      load={load}
      retry={load.reload}
      what="Finding your groups, seats, invitations and approvals…"
      isEmpty={(d) => d.length === 0}
      empty={
        <>
          <p>
            <b>You are not in a group yet.</b>
          </p>
          <p>
            <Link to="/groups">Find a group</Link>, <Link to="/looking">post that you are looking</Link>, or <Link to="/groups/new">open one</Link>.
          </p>
        </>
      }
    >
      {(groups) => (
        <ul className="my-groups" data-testid="my-groups">
          {groups.map(({ view, steps }) => (
            <li key={view.group.id} className={`my-group${view.closed ? ' closed' : ''}`}>
              <div className="my-group-head">
                <Link to={`/g/${view.group.id}`} className="fit-title">
                  {view.group.title}
                </Link>
                <CairnStack variant="row" legend={false} stones={stonesOf(view, me, () => null)} />
              </div>
              <ul className="my-steps">
                {steps.map((s) => (
                  <li key={s.role} className={`my-step next-${s.tone}`}>
                    <span className="small muted">{ROLE_WORDS[s.role]}</span> <b>{s.title}</b>
                    <span className="small block">{s.text}</span>
                  </li>
                ))}
              </ul>
              <StepLink groupId={view.group.id} steps={steps} />
            </li>
          ))}
        </ul>
      )}
    </Loaded>
  );
}

/** The button to where the most pressing step is done: the group, form or live page. */
function StepLink({ groupId, steps }: { groupId: string; steps: Step[] }) {
  const urgent = steps.find((s) => s.tone === 'todo' || s.tone === 'warn');
  return (
    <Link to={stepHref(urgent ?? steps[0]!, groupId)} className="btn btn-s">
      {urgent ? 'Do it' : 'Open'}
    </Link>
  );
}

/** For operators: forming groups that have no operator yet (the contract has no null index: newest forming groups, filtered). */
export function GroupsNeedingOperator() {
  const load = useLoad('needs-operator', async (r) => (await readNewest(r, 'group', groupsByStatus(GROUP_STATUS.forming), (d, n) => toGroup(d, n), () => false)).items.filter((g) => !g.operatorId));
  return (
    <Loaded load={load} retry={load.reload} what="Looking for groups without an operator…" isEmpty={(d) => d.length === 0} empty={<p className="small">Every open group has an operator right now.</p>}>
      {(groups) => (
        <ul className="fit-people">
          {groups.slice(0, 10).map((g) => (
            <li key={g.id} className="fit-person">
              <span>
                <Link to={`/g/${g.id}`}>{g.title}</Link>
                <span className="small muted block">{(g.roster.reduce((a, r) => a + r.amount, 0) / DUFFS).toLocaleString('en-US')} of 1000 DASH so far</span>
              </span>
              <Link to={`/g/${g.id}`} className="btn btn-s">
                Offer to run it
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Loaded>
  );
}
