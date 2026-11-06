// A group as its page shows it, computed from the documents Platform proved: the group (the organizer's roster and terms), every
// member's seat, the operator's answer, the organizer's invites and the members' approvals. Pure, so every rule here is unit-tested.
//   S1  a share counts only when the member's seat and the organizer's roster both list it, with the same amount;
//   S3  locked terms are a term sheet at one revision; approvals count only for that revision and its recomputed hash.
import {
  GROUP_FLAG, GROUP_STATUS, INVITE_STATUS, OP_ACCEPT_STATUS, SEAT_FLAG, SEAT_STATUS, termSheetFromGroup,
  type Approval, type Group, type GroupFields, type Invite, type Network, type OpAccept, type RosterEntry, type Seat,
} from '@cairn/contract';
import {
  REGULAR_COLLATERAL, areShareAmountsValid, canAddShare, canonicalize, remainingDuffs, termsHash, validateTermSheet,
  type CanAddResult, type TermIssue, type TermSheet,
} from '@cairn/shares';
import { agreementOf, type Agreement, type ApprovalState as MemberApprovalState } from './agreement.ts';

export interface GroupBundle {
  group: Group;
  seats: Seat[];
  opAccepts: OpAccept[];
  invites: Invite[];
  /** Approvals at the group's current revision. */
  approvals: Approval[];
  /** Approvals at the revision before: the last change voided them. */
  voided: Approval[];
}

export type ShareState = 'confirmed' | 'awaiting-seat' | 'amount-changed' | 'withdrawn';
export type ApprovalState = MemberApprovalState | 'none';

export interface ShareRow extends RosterEntry {
  seat?: Seat;
  state: ShareState;
  approval: ApprovalState;
  approvalDoc?: Approval;
}

export interface RequestRow {
  seat: Seat;
  /** Whether the roster can take this amount (Dash Core's share rules with the group's penalty). */
  fit: CanAddResult;
  /** The organizer's invite to this person: open (they were invited) or withdrawn (the organizer declined them). */
  invite?: Invite;
  declined: boolean;
}

const LOCKED: readonly number[] = [GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live];
export const isLockedStatus = (s: number) => LOCKED.includes(s);
const CLOSED: readonly number[] = [GROUP_STATUS.dissolved, GROUP_STATUS.cancelled];

export interface GroupView {
  group: Group;
  network: Network;
  shares: ShareRow[];
  confirmedDuffs: number;
  rosterDuffs: number;
  /** What the roster still needs to reach the collateral. */
  remaining: number;
  /** The roster is a whole valid share table and every share is confirmed by its seat. */
  full: boolean;
  /** Still taking seats: forming, not closed, room left. */
  open: boolean;
  closed: boolean;
  openAmounts: boolean;
  requests: RequestRow[];
  /** Seats withdrawn by people outside the roster (declined invites, withdrawn requests). */
  declined: Seat[];
  openInvites: Invite[];
  /** The organizer's latest invite to each person, open or withdrawn. */
  inviteFor: Map<string, Invite>;
  operatorLed: boolean;
  /** The chosen operator's own answer (member-led groups). */
  operatorAnswer?: OpAccept;
  /** Operators who accepted (or offered) and are not the chosen one. */
  offers: OpAccept[];
  coordinatorCandidates: string[];
  holderCandidates: string[];
  locked: boolean;
  /** The approvals checked against the term sheet recomputed from the group (also before lock: the form and live pages read it). */
  agreement: Agreement;
  /** ProTx hashes linked to the group: the organizer's, then co-owners' own. */
  linked: Array<{ hash: string; by: string }>;
  /** The coordinator marked the Dash-Qt session as started, or the organizer moved the group on to forming on chain. */
  sessionStarted: boolean;
  sheet: TermSheet | null;
  sheetIssues: TermIssue[];
  /** termsHash recomputed from the group document; null when the document cannot make a term sheet. */
  hash: string | null;
  /** The group's lockedHash is the recomputed hash. */
  hashOk: boolean;
  approvedCount: number;
  /** Approvals of the previous revision: the last change voided them. */
  voided: Approval[];
  ready: boolean;
  /** Why the locked group is not ready to form, in words; empty when ready (or not locked). */
  waitingFor: string[];
}

const rosterSum = (roster: readonly RosterEntry[]) => roster.reduce((a, r) => a + r.amount, 0);

/** The status a roster supports before lock: full when it is a whole valid table. */
export function rosterStatus(roster: readonly RosterEntry[]): number {
  return roster.length && areShareAmountsValid(roster.map((r) => BigInt(r.amount))).ok ? GROUP_STATUS.full : GROUP_STATUS.forming;
}

/** Can `amount` join this roster (Core's rules, the group's penalty)? */
export function fitsRoster(roster: readonly RosterEntry[], amount: number, earlyPenalty: number): CanAddResult {
  return canAddShare(
    roster.map((r) => BigInt(r.amount)),
    BigInt(amount),
    REGULAR_COLLATERAL,
    BigInt(earlyPenalty),
  );
}

export function groupView(b: GroupBundle, network: Network): GroupView {
  const g = b.group;
  const seatOf = new Map(b.seats.map((s) => [s.ownerId, s]));
  const inRoster = new Set(g.roster.map((r) => r.id));
  const locked = isLockedStatus(g.status);
  const agreement = agreementOf(g, b.approvals, network);
  const sheet = locked ? agreement.sheet : null;
  const sheetIssues = locked ? agreement.issues : [];
  const hash = locked ? agreement.hash : null;
  const hashOk = locked && agreement.lockedHashOk;

  const shares: ShareRow[] = g.roster.map((r, i) => {
    const seat = seatOf.get(r.id);
    const state: ShareState = !seat ? 'awaiting-seat' : seat.status !== SEAT_STATUS.requested ? 'withdrawn' : seat.amount !== r.amount ? 'amount-changed' : 'confirmed';
    const member = agreement.members[i]!;
    return { ...r, seat, state, approval: locked ? member.state : 'none', approvalDoc: member.approval ?? undefined };
  });
  const confirmed = shares.filter((s) => s.state === 'confirmed');
  const rosterDuffs = rosterSum(g.roster);
  const remaining = Number(remainingDuffs(g.roster.map((r) => BigInt(r.amount)), REGULAR_COLLATERAL));
  const full = remaining === 0 && confirmed.length === shares.length && areShareAmountsValid(g.roster.map((r) => BigInt(r.amount))).ok;
  const closed = CLOSED.includes(g.status);

  // only the organizer's own invites speak for the group; the newest per person wins
  const inviteFor = new Map<string, Invite>();
  for (const i of [...b.invites].filter((x) => x.ownerId === g.ownerId).sort((x, y) => (x.updatedAt ?? 0) - (y.updatedAt ?? 0))) inviteFor.set(i.toId, i);
  const outside = b.seats.filter((s) => !inRoster.has(s.ownerId));
  const withdrawnSeat = new Map(outside.filter((s) => s.status === SEAT_STATUS.withdrawn).map((s) => [s.ownerId, s]));
  // an invite the person declined (withdrew their seat after it) is no longer open, until the organizer invites again
  const openInvites = [...inviteFor.values()].filter((i) => {
    const declined = withdrawnSeat.get(i.toId);
    return i.status === INVITE_STATUS.open && !inRoster.has(i.toId) && (!declined || (i.updatedAt ?? 0) > (declined.updatedAt ?? 0));
  });
  const requests = outside
    .filter((s) => s.status === SEAT_STATUS.requested)
    .map((seat) => {
      const invite = inviteFor.get(seat.ownerId);
      return { seat, fit: fitsRoster(g.roster, seat.amount, g.earlyPenalty), invite, declined: invite?.status === INVITE_STATUS.withdrawn };
    });

  const operatorLed = !!g.operatorId && g.operatorId === g.ownerId;
  const operatorAnswer = g.operatorId && !operatorLed ? b.opAccepts.find((o) => o.ownerId === g.operatorId) : undefined;
  const offers = b.opAccepts.filter((o) => o.status === OP_ACCEPT_STATUS.accepted && o.ownerId !== g.operatorId);
  const flagged = (bit: number) => confirmed.filter((s) => (s.seat!.flags ?? 0) & bit).map((s) => s.id);
  const holderCandidates = flagged(SEAT_FLAG.votingKeyHolder);
  if (g.operatorId && !holderCandidates.includes(g.operatorId)) holderCandidates.push(g.operatorId);

  const approvedCount = shares.filter((s) => s.approval === 'approved').length;
  const waitingFor = locked ? readinessProblems({ g, shares, sheetIssues, hashOk, operatorLed, operatorAnswer, seatOf }) : [];
  return {
    group: g,
    network,
    shares,
    confirmedDuffs: rosterSum(confirmed),
    rosterDuffs,
    remaining,
    full,
    open: !closed && !locked && remaining > 0,
    closed,
    openAmounts: !!((g.flags ?? 0) & GROUP_FLAG.openAmounts),
    requests,
    declined: outside.filter((s) => s.status === SEAT_STATUS.withdrawn),
    openInvites,
    inviteFor,
    operatorLed,
    operatorAnswer,
    offers,
    coordinatorCandidates: flagged(SEAT_FLAG.canCoordinate),
    holderCandidates,
    locked,
    agreement,
    linked: linkedProTx(g, b.seats),
    sessionStarted: sessionStarted(g, b.seats),
    sheet,
    sheetIssues,
    hash,
    hashOk,
    approvedCount,
    voided: b.voided,
    ready: locked && waitingFor.length === 0,
    waitingFor,
  };
}

function readinessProblems(x: {
  g: Group;
  shares: ShareRow[];
  sheetIssues: TermIssue[];
  hashOk: boolean;
  operatorLed: boolean;
  operatorAnswer?: OpAccept;
  seatOf: Map<string, Seat>;
}): string[] {
  const { g, shares } = x;
  const out: string[] = [];
  if (x.sheetIssues.length) out.push(`The locked terms are not a valid term sheet: ${x.sheetIssues.map((i) => i.message).join(' ')}`);
  else if (!x.hashOk) out.push('The hash the organizer locked does not match the terms in the group. Ask the organizer to lock again.');
  const unconfirmed = shares.filter((s) => s.state !== 'confirmed');
  if (unconfirmed.length) out.push(`${unconfirmed.length === 1 ? 'One share is' : `${unconfirmed.length} shares are`} not confirmed by the member’s own seat.`);
  const missing = shares.filter((s) => s.approval !== 'approved');
  if (missing.length) out.push(`${missing.length === 1 ? 'One member has' : `${missing.length} members have`} not approved these terms yet.`);
  if (!g.service) out.push('The operator has not given the node’s IP address and port.');
  if (!x.operatorLed) {
    const a = x.operatorAnswer;
    if (!a || a.status !== OP_ACCEPT_STATUS.accepted) out.push('The operator has not accepted this group.');
    else if (a.rewardBps !== g.rewardBps || (a.operatorPubKey ?? '') !== (g.operatorPubKey ?? '') || (a.service ?? '') !== (g.service ?? ''))
      out.push('The operator’s own answer no longer matches the locked key, address or reward.');
  }
  // the holder's own document must still say the address the terms carry
  const holder = g.votingHolderId ?? '';
  const holderDoc =
    holder === g.operatorId && x.operatorLed ? g.votingAddress : shares.some((s) => s.id === holder) ? x.seatOf.get(holder)?.votingAddress : x.operatorAnswer?.votingAddress;
  if (g.votingAddress && holderDoc !== g.votingAddress) out.push('The voting key holder’s own record no longer shows the voting address in the terms.');
  return out;
}

const termsHashOrNull = (t: TermSheet): string | null => (validateTermSheet(t).length ? null : termsHash(t));

/** ProTx hashes linked to the group: the organizer's, then each co-owner's own (seats of people not on the roster are ignored). */
export function linkedProTx(g: Group, seats: readonly Seat[]): Array<{ hash: string; by: string }> {
  const roster = new Set(g.roster.map((r) => r.id));
  const out: Array<{ hash: string; by: string }> = [];
  const add = (hash: string | undefined, by: string) => {
    const h = hash?.toLowerCase();
    if (h && !out.some((x) => x.hash === h)) out.push({ hash: h, by });
  };
  add(g.proTxHash, g.ownerId);
  for (const s of seats) if (roster.has(s.ownerId) && s.groupId === g.id) add(s.proTxHash, s.ownerId);
  return out;
}

/** The coordinator marked the Dash-Qt session as started (their seat flag), or the organizer moved the group on to forming on chain. */
export function sessionStarted(g: Group, seats: readonly Seat[]): boolean {
  if (g.status === GROUP_STATUS.formingOnchain || g.status === GROUP_STATUS.live) return true;
  const seat = seats.find((s) => s.ownerId === g.coordinatorId && s.groupId === g.id);
  return !!seat && ((seat.flags ?? 0) & SEAT_FLAG.sessionStarted) !== 0;
}

/** The fields of a stored group, to change and write back. */
export function fieldsOf(g: Group): GroupFields {
  const { id: _i, ownerId: _o, docRevision: _r, createdAt: _c, updatedAt: _u, ...f } = g;
  return f;
}

/** The terms a group states, network aside (both sides of a comparison are on one network), with the operator chosen. */
const termsKey = (f: GroupFields) => `${f.operatorId ?? ''}|${canonicalize(termSheetFromGroup('', f, 'mainnet'))}`;

/**
 * The organizer's change to a group. Changing the terms of a locked group bumps its revision (voiding every approval) and unlocks it;
 * a change that leaves the term sheet and operator as they are (name, description, chat link, voting policy, closing it) keeps the
 * lock, so a formed masternode stays verified. A roster change moves an open group between forming and full.
 */
export function change(g: Group, next: Partial<GroupFields>): GroupFields {
  const f: GroupFields = { ...fieldsOf(g), ...next };
  const relock = next.status !== undefined && isLockedStatus(next.status);
  const closing = CLOSED.includes(f.status);
  const status = closing || relock ? f.status : rosterStatus(f.roster);
  if (!isLockedStatus(g.status) || relock) return { ...f, status };
  if (termsKey(f) === termsKey(fieldsOf(g))) return { ...f, status: closing ? f.status : g.status };
  return { ...f, status, termsRevision: g.termsRevision + 1, lockedHash: undefined };
}

export const acceptSeat = (g: Group, seat: Seat) => change(g, { roster: [...g.roster, { id: seat.ownerId, amount: seat.amount }] });
export const removeShare = (g: Group, id: string) => change(g, { roster: g.roster.filter((r) => r.id !== id), ...(g.coordinatorId === id ? { coordinatorId: undefined } : {}), ...(g.votingHolderId === id ? { votingHolderId: undefined, votingAddress: undefined } : {}) });
export const setShareAmount = (g: Group, id: string, amount: number) => change(g, { roster: g.roster.map((r) => (r.id === id ? { ...r, amount } : r)) });

/** Whether a new amount for a member already in the roster still lets the roster complete. */
export function fitsAsChange(g: Group, id: string, amount: number): CanAddResult {
  return fitsRoster(
    g.roster.filter((r) => r.id !== id),
    amount,
    g.earlyPenalty,
  );
}

export interface LockChoices {
  coordinatorId?: string;
  votingHolderId?: string;
  labels: string[];
  /** Operator-led groups: the organizer is the operator and states these in the group itself. */
  operatorPubKey?: string;
  service?: string;
  votingAddress?: string;
}

export interface LockPlan {
  fields: GroupFields;
  sheet: TermSheet;
  hash: string | null;
  problems: string[];
}

/** Where the voting address comes from: the holder's own seat, the operator's answer, or (operator-led, operator holds) the group. */
export function holderVotingAddress(v: GroupView, holderId: string | undefined, typed?: string): string | undefined {
  if (!holderId) return undefined;
  const g = v.group;
  if (holderId === g.operatorId && v.operatorLed) return typed?.trim() || undefined;
  const share = v.shares.find((s) => s.id === holderId);
  if (share) return share.seat?.votingAddress;
  return holderId === g.operatorId ? v.operatorAnswer?.votingAddress : undefined;
}

/**
 * The group as it will be locked: the choices applied, the operator's key and service taken from their own answer (member-led) or
 * from the organizer (operator-led), the term sheet built and checked. `problems` empty means it can be locked.
 */
export function lockPlan(v: GroupView, c: LockChoices): LockPlan {
  const g = v.group;
  const problems: string[] = [];
  if (!v.full) problems.push('Every share must be confirmed and the shares must add up to exactly 1000 DASH.');
  if (!g.operatorId) problems.push('Choose an operator first.');
  const answer = v.operatorAnswer;
  if (g.operatorId && !v.operatorLed) {
    if (!answer || answer.status !== OP_ACCEPT_STATUS.accepted) problems.push('The operator has not accepted this group yet.');
    else if (answer.rewardBps !== g.rewardBps) problems.push(`The operator accepted a different reward. Change the group’s reward or ask them to accept this one.`);
  }
  const key = v.operatorLed ? c.operatorPubKey?.trim().toLowerCase() : answer?.operatorPubKey;
  const service = v.operatorLed ? c.service?.trim() : answer?.service;
  if (!key) problems.push(v.operatorLed ? 'Enter your BLS operator public key.' : 'The operator has not given the BLS operator public key yet.');
  if (!service) problems.push(v.operatorLed ? 'Enter the node’s IP address and port.' : 'The operator has not given the node’s IP address and port yet.');
  const memberIds = new Set(v.shares.map((s) => s.id));
  if (!c.coordinatorId) problems.push('Choose the coordinator.');
  else if (!memberIds.has(c.coordinatorId)) problems.push('The coordinator must be one of the co-owners.');
  if (!c.votingHolderId) problems.push('Choose who holds the voting key.');
  else if (!memberIds.has(c.votingHolderId) && c.votingHolderId !== g.operatorId) problems.push('The voting key holder must be a co-owner or the operator.');
  const votingAddress = holderVotingAddress(v, c.votingHolderId, c.votingAddress);
  if (c.votingHolderId && !votingAddress) problems.push('The voting key holder has not given the voting address yet.');
  if (c.labels.length !== g.roster.length || c.labels.some((l) => !l)) problems.push('Give every share a label.');
  const roster = g.roster.map((r, i) => ({ ...r, label: c.labels[i] ?? r.label }));
  const fields: GroupFields = {
    ...fieldsOf(g),
    roster,
    coordinatorId: c.coordinatorId,
    votingHolderId: c.votingHolderId,
    votingAddress,
    operatorPubKey: key,
    service,
    status: GROUP_STATUS.locked,
    lockedHash: undefined,
  };
  // re-locking different terms is a new revision: approvals of the old one are voided, not left to mismatch
  if (v.locked && termsHashOrNull(termSheetFromGroup(g.id, fields, v.network)) !== g.lockedHash) fields.termsRevision = g.termsRevision + 1;
  const sheet = termSheetFromGroup(g.id, fields, v.network);
  const issues = validateTermSheet(sheet);
  for (const i of issues) if (!problems.includes(i.message)) problems.push(i.message);
  const hash = issues.length ? null : termsHash(sheet);
  return { fields: { ...fields, lockedHash: hash ?? undefined }, sheet, hash, problems };
}

/** Choices saved before lock (so the chosen voting key holder knows to give their address). Changed terms unlock a locked group. */
export function saveChoices(g: Group, c: LockChoices): GroupFields {
  return change(g, {
    roster: g.roster.map((r, i) => ({ ...r, label: c.labels[i] || r.label })),
    coordinatorId: c.coordinatorId,
    votingHolderId: c.votingHolderId,
    ...(g.operatorId === g.ownerId ? { operatorPubKey: c.operatorPubKey?.trim().toLowerCase() || undefined, service: c.service?.trim() || undefined, ...(c.votingHolderId === g.operatorId ? { votingAddress: c.votingAddress?.trim() || undefined } : {}) } : {}),
    ...(c.votingHolderId !== g.votingHolderId && !(g.operatorId === g.ownerId && c.votingHolderId === g.operatorId) ? { votingAddress: undefined } : {}),
  });
}

/**
 * M12 refill: a new group with the dissolved group's terms whose roster keeps everyone but the leavers, open for the leavers'
 * amount. Remaining members confirm with a seat in the new group; nothing of the old lock carries over.
 */
export function refillFields(old: Group, leaverIds: readonly string[]): GroupFields {
  const roster = old.roster.filter((r) => !leaverIds.includes(r.id));
  const keep = (id?: string) => (id && (roster.some((r) => r.id === id) || id === old.operatorId) ? id : undefined);
  return {
    ...fieldsOf(old),
    roster,
    termsRevision: 1,
    status: GROUP_STATUS.forming,
    refillOf: old.id,
    lockedHash: undefined,
    proTxHash: undefined,
    coordinatorId: keep(old.coordinatorId),
    votingHolderId: keep(old.votingHolderId),
    votingAddress: keep(old.votingHolderId) ? old.votingAddress : undefined,
  };
}

/** People who declined an invitation or withdrew a request, with no open invitation since: the organizer can invite them again. */
export function invitableAgain(v: GroupView): Array<{ seat: Seat; fit: CanAddResult }> {
  const invited = new Set(v.openInvites.map((i) => i.toId));
  return v.declined.filter((s) => !invited.has(s.ownerId)).map((seat) => ({ seat, fit: fitsRoster(v.group.roster, seat.amount, v.group.earlyPenalty) }));
}
