// "Your next step" on a group page: one step per role the viewer has in the group (DESIGN M7: one clear next step for me), through
// the whole life of the group: matching and agreeing here, forming on /g/:id/form, the masternode on /g/:id/live.
import { OP_ACCEPT_STATUS, SEAT_FLAG } from '@cairn/contract';
import type { GroupView } from './group.ts';
import { dash, pct } from './money.ts';
import { isFormed, isUnderway, stageOf, type Stage } from './stage.ts';

export type Role = 'visitor' | 'requester' | 'invitee' | 'member' | 'organizer' | 'operator';

export type StepAction =
  | 'sign-in'
  | 'request-seat'
  | 'find-another'
  | 'manage-request'
  | 'answer-invite'
  | 'confirm-seat'
  | 'voting-address'
  | 'approve'
  | 'reapprove'
  | 'form'
  | 'check'
  | 'live'
  | 'refill'
  | 'review-requests'
  | 'fix-roster'
  | 'invite'
  | 'choose-operator'
  | 'prepare-lock'
  | 'operator-answer'
  | 'operator-key'
  | 'offer'
  | 'none';

export interface Step {
  role: Role;
  tone: 'todo' | 'wait' | 'done' | 'warn';
  title: string;
  text: string;
  action: StepAction;
}

export const ROLE_WORDS: Record<Role, string> = {
  visitor: 'Next step',
  requester: 'Your request',
  invitee: 'Your invitation',
  member: 'As a co-owner',
  organizer: 'As the organizer',
  operator: 'As the operator',
};

export interface Viewer {
  id: string | null;
  /** The viewer has an operator listing (may offer to run a group that has no operator). */
  isOperator?: boolean;
}

export function rolesOf(v: GroupView, viewerId: string | null): Role[] {
  if (!viewerId) return ['visitor'];
  const g = v.group;
  const roles: Role[] = [];
  if (g.ownerId === viewerId) roles.push('organizer');
  if (g.operatorId === viewerId) roles.push('operator');
  if (v.shares.some((s) => s.id === viewerId)) roles.push('member');
  else if (v.requests.some((r) => r.seat.ownerId === viewerId)) roles.push('requester');
  else if (v.openInvites.some((i) => i.toId === viewerId)) roles.push('invitee');
  return roles.length ? roles : ['visitor'];
}

const waitingFor = (n: number, of: number) => `${of - n} of ${of} still to approve.`;

/** `stage` defaults to what the documents alone say; pages that checked the linked registration on chain pass that stage. */
export function nextSteps(v: GroupView, viewer: Viewer, stage: Stage = stageOf(v, null)): Step[] {
  return rolesOf(v, viewer.id).flatMap((role) => {
    const s = stepFor(role, v, viewer, stage);
    return s ? [s] : [];
  });
}

/** Where a step is done: the group page, the form page (and its checker), the live page, or the refill panel. */
export function stepHref(step: Pick<Step, 'action'>, groupId: string): string {
  const base = `/g/${groupId}`;
  switch (step.action) {
    case 'form':
      return `${base}/form`;
    case 'check':
      return `${base}/form#checker`;
    case 'live':
      return `${base}/live`;
    case 'refill':
      return `${base}#refill`;
    default:
      return base;
  }
}

function stepFor(role: Role, v: GroupView, viewer: Viewer, stage: Stage): Step | null {
  const g = v.group;
  const me = viewer.id;
  const step = (tone: Step['tone'], title: string, text: string, action: StepAction): Step => ({ role, tone, title, text, action });
  const later = laterStep(role, v, me, stage, step);
  if (later !== undefined) return later;
  if (v.closed) return role === 'visitor' ? null : step('done', 'This group is closed', 'The organizer closed this group. Nothing more to do here.', 'none');

  switch (role) {
    case 'visitor': {
      if (me && viewer.isOperator && !g.operatorId && !v.locked) return step('todo', 'This group needs an operator', 'Offer to run its masternode, with the reward you accept. The organizer chooses.', 'offer');
      // a co-owner who opened the group-chat link before signing in is not told they are outside their own group
      if (!me)
        return step('todo', 'Are you in this group?', `Sign in to see your row and what to do next.${v.open ? ` Not in it yet? It still needs ${dash(v.remaining)}; signing in also lets you ask for a seat.` : ''}`, 'sign-in');
      if (!v.open) return step('wait', v.locked ? 'Terms are locked' : 'This group is full', `This group is full${v.locked ? ' and its terms are locked' : ''}. Find another group your amount fits, or start one.`, 'find-another');
      if (!v.openAmounts) return step('wait', 'This group fills by invitation', 'The organizer invites the people they want. Find another group your amount fits, or start your own: organizers can invite you from there.', 'find-another');
      return step('todo', 'Ask for a seat', `Say how much you would bring. ${dash(v.remaining)} is still open. The organizer adds you to the roster.`, 'request-seat');
    }
    case 'requester': {
      const r = v.requests.find((x) => x.seat.ownerId === me)!;
      if (r.declined) return step('warn', 'The organizer declined your request', 'Your seat request stays on record until you withdraw it. Other groups may fit you.', 'manage-request');
      if (!r.fit.ok) return step('warn', 'Your amount no longer fits', `${r.fit.message} Change your amount or withdraw.`, 'manage-request');
      return step('wait', 'Waiting for the organizer', `You asked for a ${dash(r.seat.amount)} seat. The organizer adds you to the roster. You can change the amount or withdraw until then.`, 'manage-request');
    }
    case 'invitee': {
      const i = v.openInvites.find((x) => x.toId === me)!;
      return step('todo', 'You are invited', `The organizer invited you to bring ${dash(i.amount)}. Accept to take the seat, or decline.`, 'answer-invite');
    }
    case 'member':
      return memberStep(v, me!, step);
    case 'organizer':
      return organizerStep(v, step);
    case 'operator':
      return operatorStep(v, step);
  }
}

type Make = (tone: Step['tone'], title: string, text: string, action: StepAction) => Step;

/** Steps once the group is ready to form and after; undefined hands earlier stages to the per-role steps below. */
function laterStep(role: Role, v: GroupView, me: string | null, stage: Stage, step: Make): Step | null | undefined {
  const g = v.group;
  const coOwner = !!me && v.shares.some((s) => s.id === me);
  // an organizer who co-owns or operates gets one step, in that role
  if (role === 'organizer' && (coOwner || g.operatorId === me) && isUnderway(stage)) return null;
  switch (stage) {
    case 'session-started':
      if (role === 'member')
        return g.coordinatorId === me
          ? step('todo', 'Collect the replies in Dash-Qt', 'You started the session. Paste each reply into the checker before you go on; after broadcast, link the ProTx hash here.', 'form')
          : step('todo', 'Check each message before you act', 'The coordinator started the Dash-Qt session. Paste every message into the checker before you reply or sign in your wallet.', 'check');
      if (role === 'organizer' || role === 'operator') return step('wait', 'Forming in Dash-Qt', 'The coordinator started the session. Once the registration is broadcast, its ProTx hash is linked on the form page.', 'form');
      return undefined;
    case 'linked':
      return step('wait', 'Registration linked', 'Cairn checks it against the chain and every approval on the live page.', 'live');
    case 'live':
      if (role === 'operator') return step('done', 'Earning: keep the node running', 'Keep the node up and current. Without a payout address set in a service update, the operator reward goes to the co-owners.', 'live');
      if (role === 'member') return step('done', 'Earning', 'The chain shows exactly the masternode everyone approved, and the network pays it. Save your standby dissolution and keep it offline.', 'live');
      return step('done', role === 'visitor' ? 'This masternode is earning' : 'Earning', 'The chain shows exactly the masternode every member approved, and the network pays it.', 'live');
    case 'registered':
      if (role === 'operator') return step('todo', 'Registration verified: start the node', 'Put the BLS secret key on the node and send a service update with your payout address. Until the network lists it as valid, it earns nothing.', 'live');
      if (role === 'member') return step('wait', 'Registration verified, not earning yet', 'The chain shows exactly the masternode everyone approved, but the network is not paying it yet; the live page says why. Save your standby dissolution meanwhile.', 'live');
      return step('done', 'Registration verified', 'The chain shows exactly the masternode every member approved. The live page shows whether the network pays it yet.', 'live');
    case 'recorded-after':
      return step(
        'wait',
        'Registered, but not verified',
        'The masternode on chain matches these terms, but they were not all on Cairn well before it was registered, so Cairn cannot show that this group agreed to it first.',
        'live',
      );
    case 'mismatch':
      return step('warn', 'The linked registration does not match', 'It is not what every member approved. Nobody should treat it as this group’s masternode; the live page shows what differs.', 'live');
    case 'dissolved':
      if (role === 'member') return step('todo', 'The masternode was dissolved', 'Every share went back to its refund address. Reopen with the same terms; only the leavers’ amount needs filling.', 'refill');
      return role === 'visitor' ? null : step('done', 'The masternode was dissolved', 'Every share went back to its refund address.', v.linked.length ? 'live' : 'none');
    default:
      return undefined;
  }
}

function memberStep(v: GroupView, me: string, step: Make): Step {
  const g = v.group;
  const share = v.shares.find((s) => s.id === me)!;
  if (share.state === 'awaiting-seat') return step('todo', 'Confirm your seat', `The roster lists you with ${dash(share.amount)}. Confirm it with your own seat so it counts.`, 'confirm-seat');
  if (share.state === 'withdrawn') return step('wait', 'You withdrew', 'The organizer will take your share off the roster. You can ask for the seat again.', 'confirm-seat');
  if (share.state === 'amount-changed') return step('wait', 'Waiting for the organizer', `You asked to change your share to ${dash(share.seat!.amount)}; the roster still says ${dash(share.amount)}.`, 'manage-request');
  if (!v.locked) {
    if (g.ownerId === me) return step('done', 'Your share is in', 'Your next steps are under “As the organizer”.', 'none');
    if (!v.full) return step('wait', 'You are in', `The group needs ${dash(v.remaining)} more before the terms can be locked.`, 'none');
    if (g.votingHolderId === me && !share.seat?.votingAddress)
      return step('todo', 'Give the voting address', 'The group chose you to hold the voting key. Make a new address in Dash Core and give it here; it goes into the terms.', 'voting-address');
    return step('wait', 'Waiting for the organizer to lock the terms', 'The group is full. Once the organizer locks the terms, you approve them here.', 'none');
  }
  if (share.approval === 'mismatch') return step('warn', 'Your approval does not match', 'Your approval is for different terms or a different amount. Withdraw it and approve the terms as they are now.', 'reapprove');
  if (share.approval === 'missing') return step('todo', 'Approve the terms', 'Read the term sheet. Your approval is recorded on Dash Platform, and every later step is checked against it.', 'approve');
  if (v.ready) return step('done', 'Ready to form', g.coordinatorId === me ? 'You coordinate: start the shared masternode in Dash-Qt.' : 'Everyone approved. The coordinator starts the masternode in Dash-Qt; you confirm and sign there.', 'form');
  return step('wait', 'You approved', `${waitingFor(v.approvedCount, v.shares.length)} ${v.waitingFor[0] ?? ''}`.trim(), 'none');
}

function organizerStep(v: GroupView, step: Make): Step {
  const g = v.group;
  if (v.locked) {
    if (v.ready) return step('done', 'Ready to form', 'Every member approved these terms. The coordinator starts the masternode in Dash-Qt.', 'form');
    if (!v.hashOk) return step('warn', 'Lock the terms again', v.waitingFor[0] ?? 'The locked hash does not match the terms.', 'prepare-lock');
    return step('wait', 'Waiting for approvals', `${waitingFor(v.approvedCount, v.shares.length)} ${v.waitingFor.find((w) => !/approved/.test(w)) ?? ''}`.trim(), 'none');
  }
  const asks = v.requests.filter((r) => r.fit.ok && !r.declined);
  if (asks.length) return step('todo', `Review ${asks.length === 1 ? 'a seat request' : `${asks.length} seat requests`}`, 'Add people to the roster, or leave them waiting. A seat counts once both of you list it.', 'review-requests');
  const stale = v.shares.filter((s) => s.state === 'amount-changed' || s.state === 'withdrawn');
  if (stale.length) return step('todo', 'Update the roster', `${stale.length === 1 ? 'A member' : `${stale.length} members`} changed or withdrew a seat.`, 'fix-roster');
  if (!g.operatorId) return step('todo', 'Choose an operator', v.offers.length ? `${v.offers.length === 1 ? 'An operator has' : `${v.offers.length} operators have`} offered to run this node.` : 'Pick one from the directory, or wait for an offer.', 'choose-operator');
  if (v.remaining > 0) return step('todo', 'Find co-owners', `${dash(v.remaining)} is still open. Invite people waiting in a group they started, or share this page.`, 'invite');
  if (v.shares.some((s) => s.state === 'awaiting-seat')) return step('wait', 'Waiting for members to confirm', 'Some people on the roster have not confirmed their seat yet.', 'none');
  if (!v.operatorLed && v.operatorAnswer?.status !== OP_ACCEPT_STATUS.accepted) return step('wait', 'Waiting for the operator', 'The operator has not accepted this group yet.', 'none');
  return step('todo', 'Prepare and lock the terms', 'Choose the coordinator and the voting key holder, check the share labels, then lock. Members approve what you lock.', 'prepare-lock');
}

function operatorStep(v: GroupView, step: Make): Step | null {
  const g = v.group;
  if (v.operatorLed) return null; // the organizer's step covers it
  const a = v.operatorAnswer;
  if (v.locked) return v.ready ? step('done', 'Ready to form', 'After the masternode is registered, put the BLS secret key on your node and set your payout address.', 'form') : step('wait', 'Terms are locked', 'Members are approving the terms.', 'none');
  if (!a || a.status === OP_ACCEPT_STATUS.withdrawn) return step('todo', 'Will you run this node?', `The organizer chose you, at ${pct(g.rewardBps)} of the rewards. Accept or decline.`, 'operator-answer');
  if (a.status === OP_ACCEPT_STATUS.declined) return step('done', 'You declined', 'The organizer will choose another operator. You can still accept.', 'operator-answer');
  if (a.rewardBps !== g.rewardBps)
    return step('wait', 'The reward differs', `You accepted ${pct(a.rewardBps ?? 0)}; the group proposes ${pct(g.rewardBps)}. The organizer can take yours, or you can accept theirs.`, 'operator-answer');
  if (!a.operatorPubKey || !a.service) return step('todo', 'Give your key and the node’s address', 'The BLS operator public key and the IP address and port go into the terms before lock.', 'operator-key');
  if (g.votingHolderId === g.operatorId && !v.shares.some((s) => s.id === g.operatorId) && !a.votingAddress) return step('todo', 'Give the voting address', 'The group chose you to hold the voting key.', 'voting-address');
  return step('wait', 'You are set', 'Waiting for the group to fill and the organizer to lock the terms.', 'none');
}

/** Whether a seat offers to coordinate or hold the voting key. */
export const seatOffers = (flags: number | undefined) => ({ coordinate: !!((flags ?? 0) & SEAT_FLAG.canCoordinate), holdKey: !!((flags ?? 0) & SEAT_FLAG.votingKeyHolder) });

/** A seat's flags with these two offers; other bits the seat already has (the coordinator's session start) are kept. */
export const seatFlags = (coordinate: boolean, holdKey: boolean, prev = 0) =>
  (prev & ~(SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder)) | (coordinate ? SEAT_FLAG.canCoordinate : 0) | (holdKey ? SEAT_FLAG.votingKeyHolder : 0);
