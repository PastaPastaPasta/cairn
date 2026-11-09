// /me: every group the signed-in identity is part of (organizer, co-owner, requester, invitee, operator), each with its next step.
// Found through the indexes the contract has for this (groups by owner and by operator, seats, invites and answers by owner);
// approvals come with each group (DESIGN §7: "my approvals" is a few queries per group, not an index).
import {
  GROUP_STATUS, INVITE_STATUS, LOOKING_STATUS, deleteOp, groupData, groupsByStatus, lookingOf, replaceOp, toLooking, groupsOfOperator, groupsOrganizedBy, invitesTo, opAcceptsOf, seatsOf, toGroup, toInvite, toOpAccept, toSeat,
} from '@cairn/contract';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/context.tsx';
import { useWrite } from '../../data/write.ts';
import { startedAlone } from '../../matching/match.ts';
import { useAction } from '../../ui/useAction.ts';
import type { Registry } from '../../config/registry.ts';
import { loadGroupBundle, rawId, readAll, readNewest, readOwn, useLoad } from '../../data/cairn.ts';
import { change, groupView, type GroupView } from '../../matching/group.ts';
import { FORM_BY_PASSED, formByNoteFor } from '../../matching/deadline.ts';
import { DUFFS, dash, dashNum } from '../../matching/money.ts';
import { ROLE_WORDS, nextSteps, stepHref, type Step } from '../../matching/nextstep.ts';
import { stageOf } from '../../matching/stage.ts';
import { useGroupRegistrations } from '../../formation/useRegistration.ts';
import { CairnStack } from '../../ui/CairnStack.tsx';
import { Loaded, WriteStatus } from '../../ui/Loaded.tsx';
import { stonesOf } from '../group/GroupPage.tsx';

const MAX_GROUPS = 24;

export interface MyGroup {
  view: GroupView;
  steps: Step[];
  /** The form-by date passed before the group formed, and I am on its roster. */
  formByPassed: boolean;
}

async function loadMyGroups(r: Registry, me: string, isOperator: boolean): Promise<MyGroup[]> {
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
      return { view, steps: nextSteps(view, { id: me, isOperator }).filter((s) => s.role !== 'visitor'), formByPassed: formByNoteFor(view, me, stageOf(view, null)) };
    })
    .filter((g) => g.steps.length > 0)
    .sort((a, b) => Number(a.view.closed) - Number(b.view.closed) || Math.min(...a.steps.map((s) => order[s.tone])) - Math.min(...b.steps.map((s) => order[s.tone])) || (b.view.group.updatedAt ?? 0) - (a.view.group.updatedAt ?? 0));
}

/**
 * A group I started and am still alone in, while I am on another open group's roster: the first is now only a listing that invites
 * people to a seat I will not keep, so it is worth closing.
 */
export function startedButMovedOn(groups: readonly MyGroup[], me: string): Array<{ started: GroupView; joined: GroupView }> {
  const joined = groups.find((g) => !g.view.closed && g.view.group.ownerId !== me && g.view.group.roster.some((r) => r.id === me));
  if (!joined) return [];
  return groups.filter((g) => g.view.group.ownerId === me && startedAlone(g.view.group)).map((g) => ({ started: g.view, joined: joined.view }));
}

export function MyGroups({ me, isOperator, onGroups }: { me: string; isOperator: boolean; onGroups?(groups: MyGroup[]): void }) {
  const load = useLoad(`my-groups:${me}:${isOperator}`, (r) => loadMyGroups(r, me, isOperator));
  const data = load.status === 'ready' ? load.data : null;
  useEffect(() => {
    if (data) onGroups?.(data);
  }, [data, onGroups]);
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
            <Link to="/groups">Say how much you can bring</Link> to see the groups it fits, or start one that others can join.
          </p>
        </>
      }
    >
      {(groups) => (
        <>
          {startedButMovedOn(groups, me).map((m) => (
            <CloseStarted key={m.started.group.id} started={m.started} joined={m.joined} onClosed={load.reload} />
          ))}
          <ul className="my-groups" data-testid="my-groups">
            {groups.map((g) => (
              <MyGroupItem key={g.view.group.id} group={g} me={me} isOperator={isOperator} />
            ))}
          </ul>
        </>
      )}
    </Loaded>
  );
}

/** A group's steps, with a linked registration checked on chain, so they say registered or earning as the group page does. */
function useCheckedSteps({ view, steps: fromDocs }: MyGroup, me: string, isOperator: boolean): Step[] {
  const reg = useGroupRegistrations(view);
  return reg.primary ? nextSteps(view, { id: me, isOperator }, stageOf(view, reg.primary)).filter((s) => s.role !== 'visitor') : fromDocs;
}

function MyGroupItem({ group, me, isOperator }: { group: MyGroup; me: string; isOperator: boolean }) {
  const { view, steps: fromDocs, formByPassed } = group;
  const steps = useCheckedSteps(group, me, isOperator);
  return (
    <li className={`my-group${view.closed ? ' closed' : ''}`}>
      <div className="my-group-head">
        <Link to={`/g/${view.group.id}`} className="fit-title">
          {view.group.title}
        </Link>
        <CairnStack variant="row" legend={false} closed={view.closed} stones={stonesOf(view, me, () => null)} />
      </div>
      <ul className="my-steps">
        {steps.map((s) => (
          <li key={s.role} className={`my-step next-${s.tone}`}>
            <span className="small muted">{ROLE_WORDS[s.role]}</span> <b>{s.title}</b>
            <span className="small block">{s.text}</span>
          </li>
        ))}
      </ul>
      {formByPassed && (
        <p className="small notice-box" role="note" data-testid="form-by-passed">
          {FORM_BY_PASSED}
        </p>
      )}
      <StepLink groupId={view.group.id} steps={steps.length ? steps : fromDocs} />
    </li>
  );
}

/** Signed-in Home: the most pressing step in each of my groups, before anything else on the page (DESIGN §5: for a member the CTA is their next step). */
export function NextStepBand({ me }: { me: string }) {
  // the operator flag only decides a visitor's offer step, which /me never shows
  const load = useLoad(`my-groups:${me}:false`, (r) => loadMyGroups(r, me, false));
  if (load.status !== 'ready') return null;
  return <NextStepList groups={load.data} me={me} />;
}

export function NextStepList({ groups, me }: { groups: MyGroup[]; me: string }) {
  const open = groups.filter((g) => !g.view.closed);
  if (!open.length) return null;
  return (
    <section className="next-band" aria-labelledby="next-band-title" data-testid="next-band">
      <h2 id="next-band-title" className="h3">
        Your next step
      </h2>
      <ul className="my-groups">
        {open.slice(0, 3).map((g) => (
          <NextStepItem key={g.view.group.id} group={g} me={me} />
        ))}
      </ul>
      {open.length > 3 && (
        <p className="small">
          <Link to="/me">All {open.length} of your groups</Link>
        </p>
      )}
    </section>
  );
}

function NextStepItem({ group, me }: { group: MyGroup; me: string }) {
  const { view, steps: fromDocs, formByPassed } = group;
  const checked = useCheckedSteps(group, me, false);
  const steps = checked.length ? checked : fromDocs;
  const s = steps.find((x) => x.tone === 'todo' || x.tone === 'warn') ?? steps[0]!;
  return (
    <li className="my-group">
      <div className="my-group-head">
        <Link to={`/g/${view.group.id}`} className="fit-title">
          {view.group.title}
        </Link>
      </div>
      <p className={`my-step next-${s.tone}`}>
        <span className="small muted">{ROLE_WORDS[s.role]}:</span> <b>{s.title}</b>
        <span className="small block">{s.text}</span>
        {formByPassed && <span className="small block">{FORM_BY_PASSED}</span>}
      </p>
      <StepLink groupId={view.group.id} steps={steps} />
    </li>
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

/** A note with one write behind a button, and the write's status under it. */
function ActionNotice({ testId, button, busy, error, onClick, children }: { testId: string; button: { label: string; busyLabel: string; testId: string }; busy: boolean; error: string | null; onClick(): Promise<void>; children: ReactNode }) {
  return (
    <div className="notice-box close-started" role="note" data-testid={testId}>
      <p>{children}</p>
      <p className="form-actions">
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void onClick()} data-testid={button.testId}>
          {busy ? button.busyLabel : button.label}
        </button>
      </p>
      <WriteStatus busy={busy} error={error} />
    </div>
  );
}

/** "You are in X now: close Y, the group you started?" One write: the group's status becomes cancelled. */
function CloseStarted({ started, joined, onClosed }: { started: GroupView; joined: GroupView; onClosed(): void }) {
  const { registry } = useApp();
  const write = useWrite();
  const { busy, error, run } = useAction();
  const g = started.group;
  const close = () =>
    run(async () => {
      try {
        await write(() => replaceOp(registry.contractId!, 'group', g.id, g.docRevision, groupData(change(g, { status: GROUP_STATUS.cancelled }), registry.network)));
      } finally {
        // re-read after a refusal too: a stale group (someone joined meanwhile) must show its latest state, not fail the same way again
        onClosed();
      }
    });
  return (
    <ActionNotice testId="close-started" button={{ label: `Close ${g.title}`, busyLabel: 'Closing…', testId: 'close-started-btn' }} busy={busy} error={error} onClick={close}>
      You are in <Link to={`/g/${joined.group.id}`}>{joined.group.title}</Link> now, and <Link to={`/g/${g.id}`}>{g.title}</Link>, the group you started, still invites people to
      join you there. Close it so nobody asks for a seat you will not take?
    </ActionNotice>
  );
}

/**
 * A "looking" post from before groups were the only listing: still public, and nothing else reads it now. Offered once for removal,
 * so an old amount and note do not stay on Platform unnoticed.
 */
export function OldLookingPost({ me }: { me: string }) {
  const { registry } = useApp();
  const write = useWrite();
  const { busy, error, run } = useAction();
  const load = useLoad(`old-looking:${me}`, (r) => readOwn(r, 'looking', lookingOf(me), me, (d) => toLooking(d)));
  const post = load.status === 'ready' ? load.data : null;
  if (!post || post.status === LOOKING_STATUS.closed) return null;
  const remove = () =>
    run(async () => {
      try {
        await write(deleteOp(registry.contractId!, 'looking', post.id));
      } finally {
        load.reload();
      }
    });
  return (
    <ActionNotice testId="old-looking" button={{ label: 'Remove it', busyLabel: 'Removing…', testId: 'remove-looking' }} busy={busy} error={error} onClick={remove}>
      You still have a public “looking for a group” post ({dash(post.amount)}). Cairn no longer lists those: to be found, start a group with your amount on{' '}
      <Link to={`/groups?amount=${encodeURIComponent(dashNum(post.amount))}`}>Find your group</Link>. Remove the old post?
    </ActionNotice>
  );
}
