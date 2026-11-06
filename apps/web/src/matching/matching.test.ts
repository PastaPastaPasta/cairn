import { GROUP_STATUS, INVITE_STATUS, OP_ACCEPT_STATUS, SEAT_FLAG, SEAT_STATUS, groupData, termSheetFromGroup, toGroup, type Invite } from '@cairn/contract';
import { termsHash } from '@cairn/shares';
import { describe, expect, it } from 'vitest';
import { EXIT_PRESETS, exitProblem, exitWords, termWarnings } from './exit.ts';
import { A, B, BLS, C, D, GID, OPR, ORG, SERVICE, VOTING, approval, group, id, looking, opAccept, seat } from './fixtures.ts';
import { acceptSeat, change, groupView, lockPlan, refillFields, removeShare, saveChoices, type GroupBundle } from './group.ts';
import { asciiLabel, deriveLabels, labelProblem } from './labels.ts';
import { combosWith, completions, filterGroups, lookingThatFits, rankGroups } from './match.ts';
import { parseDashInput, parsePercentInput } from './money.ts';
import { nextSteps, rolesOf, seatFlags, stepHref } from './nextstep.ts';
import { stageOf } from './stage.ts';

const bundle = (over: Partial<GroupBundle> = {}): GroupBundle => ({ group: group(), seats: [], opAccepts: [], invites: [], approvals: [], voided: [], ...over });
const invite = (toId: string, amount: number): Invite => ({ id: id(70), ownerId: ORG, docRevision: 1, groupId: GID, toId, amount, status: INVITE_STATUS.open }) as Invite;

describe('exit terms', () => {
  it('offer presets in blocks at 576 a day, up to Core’s cap', () => {
    expect(EXIT_PRESETS.map((p) => p.blocks)).toEqual([0, 52_416, 104_832, 210_240, 420_480]);
  });
  it('enforce the penalty rules as you type', () => {
    expect(exitProblem(0, 0)).toBeNull();
    expect(exitProblem(0, D(1))).toMatch(/nothing to penalise/);
    expect(exitProblem(52_416, 0)).toMatch(/Set a penalty/);
    expect(exitProblem(52_416, D(10))).toBeNull();
    expect(exitProblem(52_416, D(100), D(100))).toMatch(/less than the smallest share \(100 DASH\)/);
    expect(exitProblem(420_481, D(1))).toMatch(/at most 420,480/);
  });
  it('say what leaving costs, and warn about free exits and the permanent reward', () => {
    expect(exitWords(0, 0)).toBe('Anyone can leave at any time, with no penalty.');
    expect(exitWords(210_240, D(25))).toBe('Leaving in the first 1 year costs 25 DASH, paid to the others. After that, anyone can leave at no cost.');
    expect(termWarnings({ earlyPeriodBlocks: 0, rewardBps: 1500 }).map((w) => w.id)).toEqual(['free-exit', 'reward-permanent']);
    expect(termWarnings({ earlyPeriodBlocks: 1, rewardBps: 1500 }).map((w) => w.id)).toEqual(['reward-permanent']);
  });
});

describe('inputs', () => {
  it('parse DASH exactly and percentages to basis points', () => {
    expect(parseDashInput('300')).toBe(D(300));
    expect(parseDashInput('12.5 DASH')).toBe(1_250_000_000);
    expect(parseDashInput('1e3')).toBeNull();
    expect(parsePercentInput('12.5%')).toBe(1250);
    expect(parsePercentInput('100')).toBe(10_000);
    expect(parsePercentInput('101')).toBeNull();
  });
});

describe('share labels', () => {
  it('are short plain ASCII derived from names, unique ignoring case', () => {
    expect(asciiLabel('Zoë Ångström')).toBe('Zoe Angstrom');
    expect(asciiLabel('lena.dash')).toBe('lena');
    expect(asciiLabel('🙂')).toBe('');
    expect(deriveLabels([{ id: A }, { id: B }, { id: C }], (x) => ({ [A]: 'Lena', [B]: 'lena', [C]: null })[x] ?? null)).toEqual(['Lena', 'lena 2', 'Member 3']);
    expect(deriveLabels([{ id: A, label: 'Boss' }, { id: B }], () => 'Boss')).toEqual(['Boss', 'Boss 2']);
    expect(labelProblem('Lena', ['LENA'])).toMatch(/same label/);
    expect(labelProblem('Léna', [])).toMatch(/ASCII/);
    expect(labelProblem(' Lena', [])).toMatch(/spaces/);
  });
});

describe('the group view', () => {
  it('counts a share only when seat and roster agree (S1)', () => {
    const g = group({ roster: [{ id: A, amount: D(300) }, { id: B, amount: D(200) }, { id: C, amount: D(100) }, { id: OPR, amount: D(150) }] });
    const v = groupView(bundle({ group: g, seats: [seat(A, D(300)), seat(B, D(250)), seat(OPR, D(150), { status: SEAT_STATUS.withdrawn })] }), 'testnet');
    expect(v.shares.map((s) => s.state)).toEqual(['confirmed', 'amount-changed', 'awaiting-seat', 'withdrawn']);
    expect(v.confirmedDuffs).toBe(D(300));
    expect(v.remaining).toBe(D(250));
    expect(v.full).toBe(false);
  });

  it('lists requests with whether the roster can take them', () => {
    const g = group({ roster: [{ id: A, amount: D(500) }] });
    const v = groupView(bundle({ group: g, seats: [seat(A, D(500)), seat(B, D(450)), seat(C, D(300))], invites: [invite(C, D(300))] }), 'testnet');
    expect(v.requests.map((r) => [r.seat.ownerId, r.fit.ok, !!r.invite])).toEqual([
      [B, false, false],
      [C, true, true],
    ]);
  });

  it('accepting a request completes the roster and marks the group full', () => {
    const g = group({ roster: [{ id: A, amount: D(600) }] });
    const f = acceptSeat(g, seat(B, D(400)));
    expect(f.status).toBe(GROUP_STATUS.full);
    expect(() => groupData(f, 'testnet')).not.toThrow();
    expect(removeShare({ ...g, ...f }, B).status).toBe(GROUP_STATUS.forming);
  });
});

/** A full, confirmed group with operator and holder ready to lock. */
function readyToLock() {
  const g = group({
    roster: [
      { id: A, amount: D(600) },
      { id: B, amount: D(400) },
    ],
    status: GROUP_STATUS.full,
  });
  const seats = [seat(A, D(600), { flags: SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder, votingAddress: VOTING }), seat(B, D(400))];
  return bundle({ group: g, seats, opAccepts: [opAccept()] });
}

describe('lock and approve (S3, M8)', () => {
  it('lists what is missing before lock', () => {
    const v = groupView(readyToLock(), 'testnet');
    expect(v.coordinatorCandidates).toEqual([A]);
    expect(v.holderCandidates).toEqual([A, OPR]);
    const p = lockPlan(v, { labels: ['', 'Bo'] });
    expect(p.problems).toEqual(expect.arrayContaining(['Choose the coordinator.', 'Choose who holds the voting key.', 'Give every share a label.']));
    expect(p.hash).toBeNull();
  });

  it('builds the term sheet from the documents and hashes it', () => {
    const v = groupView(readyToLock(), 'testnet');
    const p = lockPlan(v, { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] });
    expect(p.problems).toEqual([]);
    expect(p.sheet).toMatchObject({ network: 'test', groupId: GID, revision: 1, operatorPubKey: BLS, service: SERVICE, votingAddress: VOTING, coordinatorId: A, votingHolderId: A, rewardBps: 1000 });
    expect(p.sheet.shares.map((s) => [s.label, s.amount])).toEqual([
      ['Ana', BigInt(D(600))],
      ['Bo', BigInt(D(400))],
    ]);
    expect(p.hash).toBe(termsHash(p.sheet));
    expect(() => groupData(p.fields, 'testnet')).not.toThrow();
    // what the members recompute from the stored document is what the organizer locked
    const stored = toGroup({ $id: GID, $ownerId: ORG, $revision: 3, ...groupData(p.fields, 'testnet') }, 'testnet');
    expect(termsHash(termSheetFromGroup(GID, stored, 'testnet'))).toBe(p.hash);
  });

  it('refuses when the operator has not accepted the group’s reward', () => {
    const b = readyToLock();
    const v = groupView({ ...b, opAccepts: [opAccept({ rewardBps: 1200 })] }, 'testnet');
    expect(lockPlan(v, { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] }).problems.join(' ')).toMatch(/different reward/);
  });

  function locked() {
    const b = readyToLock();
    const p = lockPlan(groupView(b, 'testnet'), { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] });
    return { b: { ...b, group: { ...b.group, ...p.fields } }, hash: p.hash! };
  }

  it('checks each approval against the hash recomputed from the group, and reaches ready', () => {
    const { b, hash } = locked();
    let v = groupView(b, 'testnet');
    expect(v.hashOk).toBe(true);
    expect(v.ready).toBe(false);
    expect(v.shares.map((s) => s.approval)).toEqual(['missing', 'missing']);
    v = groupView({ ...b, approvals: [approval(A, hash, D(600)), approval(B, 'f'.repeat(64), D(400))] }, 'testnet');
    expect(v.shares.map((s) => s.approval)).toEqual(['approved', 'mismatch']);
    v = groupView({ ...b, approvals: [approval(A, hash, D(600)), approval(B, hash, D(300))] }, 'testnet');
    expect(v.shares.map((s) => s.approval)).toEqual(['approved', 'mismatch']);
    v = groupView({ ...b, approvals: [approval(A, hash, D(600)), approval(B, hash, D(400))] }, 'testnet');
    expect(v.ready).toBe(true);
    expect(v.waitingFor).toEqual([]);
    expect(nextSteps(v, { id: B }).map((s) => [s.role, s.title])).toEqual([['member', 'Ready to form']]);
  });

  it('shows a locked hash that does not match the terms in red', () => {
    const { b, hash } = locked();
    const v = groupView({ ...b, group: { ...b.group, rewardBps: 900 }, approvals: [approval(A, hash, D(600)), approval(B, hash, D(400))] }, 'testnet');
    expect(v.hashOk).toBe(false);
    expect(v.shares.map((s) => s.approval)).toEqual(['mismatch', 'mismatch']);
    expect(v.ready).toBe(false);
    expect(nextSteps(v, { id: ORG })[0]).toMatchObject({ tone: 'warn', action: 'prepare-lock' });
  });

  it('is not ready when the operator’s own answer moved after lock', () => {
    const { b, hash } = locked();
    const v = groupView({ ...b, opAccepts: [opAccept({ service: '45.32.70.132:19999' })], approvals: [approval(A, hash, D(600)), approval(B, hash, D(400))] }, 'testnet');
    expect(v.ready).toBe(false);
    expect(v.waitingFor.join(' ')).toMatch(/no longer matches/);
  });

  it('re-locking changed terms makes a new revision; re-locking the same terms does not', () => {
    const { b } = locked();
    const v = groupView(b, 'testnet');
    expect(lockPlan(v, { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] }).fields.termsRevision).toBe(1);
    const p = lockPlan(v, { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bob'] });
    expect(p.fields.termsRevision).toBe(2);
    expect(p.sheet.revision).toBe(2);
  });

  it('takes the voting address from the seat of an operator who is also a co-owner', () => {
    const b = readyToLock();
    const g = { ...b.group, roster: [{ id: OPR, amount: D(600) }, { id: B, amount: D(400) }] };
    const v = groupView({ ...b, group: g, seats: [seat(OPR, D(600), { flags: SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder, votingAddress: VOTING }), seat(B, D(400))] }, 'testnet');
    expect(lockPlan(v, { coordinatorId: OPR, votingHolderId: OPR, labels: ['Op', 'Bo'] }).problems).toEqual([]);
  });

  it('a change to locked terms bumps the revision and unlocks, voiding approvals', () => {
    const { b } = locked();
    const f = change(b.group, { rewardBps: 900 });
    expect(f).toMatchObject({ termsRevision: 2, status: GROUP_STATUS.full, lockedHash: undefined });
    expect(saveChoices(b.group, { coordinatorId: B, votingHolderId: A, labels: ['Ana', 'Bo'] }).termsRevision).toBe(2);
    expect(change(b.group, { operatorId: C }).termsRevision).toBe(2);
    expect(change(group(), { title: 'x' }).termsRevision).toBe(1);
  });

  it('a change that leaves the term sheet as it is keeps the lock, so a formed masternode stays verified', () => {
    const { b, hash } = locked();
    const live = { ...b.group, status: GROUP_STATUS.live };
    for (const next of [{ title: 'Renamed' }, { chatUrl: 'https://discord.gg/x', votingPolicy: 'majority' }]) expect(change(live, next)).toMatchObject({ ...next, termsRevision: 1, status: GROUP_STATUS.live, lockedHash: hash });
    expect(change(b.group, { status: GROUP_STATUS.cancelled })).toMatchObject({ termsRevision: 1, status: GROUP_STATUS.cancelled, lockedHash: hash });
    expect(saveChoices(b.group, { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] })).toMatchObject({ termsRevision: 1, status: GROUP_STATUS.locked });
    expect('docRevision' in change(b.group, { title: 'x' })).toBe(false);
  });
});

describe('next steps per role', () => {
  it('give every viewer one clear step', () => {
    const g = group({ roster: [{ id: A, amount: D(500) }] });
    const b = bundle({ group: g, seats: [seat(A, D(500)), seat(B, D(200))], invites: [invite(C, D(300))] });
    const v = groupView(b, 'testnet');
    expect(rolesOf(v, null)).toEqual(['visitor']);
    expect(nextSteps(v, { id: null })[0]!.action).toBe('sign-in');
    expect(nextSteps(v, { id: id(77) })[0]!.action).toBe('request-seat');
    expect(nextSteps(v, { id: B })[0]).toMatchObject({ role: 'requester', action: 'manage-request' });
    expect(nextSteps(v, { id: C })[0]).toMatchObject({ role: 'invitee', action: 'answer-invite' });
    expect(nextSteps(v, { id: A })[0]).toMatchObject({ role: 'member', tone: 'wait' });
    expect(nextSteps(v, { id: ORG })[0]).toMatchObject({ role: 'organizer', action: 'review-requests' });
    expect(nextSteps(v, { id: OPR })[0]).toMatchObject({ role: 'operator', action: 'operator-answer' });
    const answered = groupView({ ...b, opAccepts: [opAccept({ operatorPubKey: undefined })] }, 'testnet');
    expect(nextSteps(answered, { id: OPR })[0]).toMatchObject({ role: 'operator', action: 'operator-key' });
  });

  it('close an invitation the person declined, until the organizer invites again', () => {
    const declined = { ...seat(C, D(300), { status: SEAT_STATUS.withdrawn }), updatedAt: 10 };
    const inv = { ...invite(C, D(300)), updatedAt: 5 };
    const v = groupView(bundle({ seats: [declined], invites: [inv] }), 'testnet');
    expect(v.openInvites).toEqual([]);
    expect(rolesOf(v, C)).toEqual(['visitor']);
    const again = groupView(bundle({ seats: [declined], invites: [{ ...inv, updatedAt: 20 }] }), 'testnet');
    expect(rolesOf(again, C)).toEqual(['invitee']);
  });

  it('send the operator of a member-led group to accept, and an invitation-only visitor to post', () => {
    const v = groupView(bundle({ group: group({ flags: 0 }) }), 'testnet');
    expect(nextSteps(v, { id: OPR })[0]!.action).toBe('operator-answer');
    expect(nextSteps(v, { id: id(77) })[0]!.action).toBe('post-looking');
    const noOp = groupView(bundle({ group: group({ operatorId: null }) }), 'testnet');
    expect(nextSteps(noOp, { id: id(77), isOperator: true })[0]!.action).toBe('offer');
    expect(nextSteps(noOp, { id: ORG })[0]!.action).toBe('choose-operator');
  });

  it('ask the chosen voting key holder for the address', () => {
    const b = readyToLock();
    const v = groupView({ ...b, group: { ...b.group, coordinatorId: B, votingHolderId: B } }, 'testnet');
    expect(nextSteps(v, { id: B })[0]!.action).toBe('voting-address');
    const op = groupView({ ...b, group: { ...b.group, votingHolderId: OPR } }, 'testnet');
    expect(nextSteps(op, { id: OPR })[0]!.action).toBe('voting-address');
  });
});

describe('lifecycle: locked → ready → session started → linked → live | mismatch → dissolved', () => {
  function ready(over: Partial<GroupBundle> = {}) {
    const b = readyToLock();
    const p = lockPlan(groupView(b, 'testnet'), { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] });
    const g = { ...b.group, ...p.fields };
    return { ...b, group: g, approvals: [approval(A, p.hash!, D(600)), approval(B, p.hash!, D(400))], ...over };
  }
  const PROTX = 'd4'.repeat(32);

  it('takes from the documents what only they know, and from the chain what the chain knows', () => {
    expect(stageOf(groupView(readyToLock(), 'testnet'), null)).toBe('full');
    const b = ready();
    expect(stageOf(groupView({ ...b, approvals: [] }, 'testnet'), null)).toBe('locked');
    expect(stageOf(groupView(b, 'testnet'), null)).toBe('ready');
    const started = { ...b, seats: [seat(A, D(600), { flags: SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder | SEAT_FLAG.sessionStarted, votingAddress: VOTING }), seat(B, D(400))] };
    expect(stageOf(groupView(started, 'testnet'), null)).toBe('session-started');
    // the organizer's "live" claim is not a verdict: a linked registration waits for the chain
    const claimed = groupView({ ...b, group: { ...b.group, status: GROUP_STATUS.live, proTxHash: PROTX } }, 'testnet');
    expect(stageOf(claimed, null)).toBe('linked');
    expect(stageOf(claimed, { state: 'verified', mnState: 'valid' })).toBe('live');
    expect(stageOf(claimed, { state: 'unproven', mnState: 'valid' })).toBe('linked');
    expect(stageOf(claimed, { state: 'mismatch', mnState: 'dissolved' })).toBe('mismatch');
    expect(stageOf(claimed, { state: 'verified', mnState: 'dissolved' })).toBe('dissolved');
    // a co-owner links from their own seat just as well; the chain still decides, even over a "cancelled" claim
    const bySeat = groupView({ ...b, group: { ...b.group, status: GROUP_STATUS.cancelled }, seats: [seat(A, D(600), { proTxHash: PROTX, votingAddress: VOTING }), seat(B, D(400))] }, 'testnet');
    expect(stageOf(bySeat, { state: 'verified', mnState: 'banned' })).toBe('live');
    expect(stageOf(groupView({ ...readyToLock(), group: { ...readyToLock().group, status: GROUP_STATUS.cancelled } }, 'testnet'), null)).toBe('closed');
  });

  it('gives each role its next step at every stage, and links it to the page where it is done', () => {
    const b = ready();
    const started = groupView({ ...b, seats: [seat(A, D(600), { flags: SEAT_FLAG.sessionStarted, votingAddress: VOTING }), seat(B, D(400))] }, 'testnet');
    expect(nextSteps(started, { id: A }, 'session-started')[0]).toMatchObject({ role: 'member', action: 'form' });
    expect(nextSteps(started, { id: B }, 'session-started')[0]).toMatchObject({ role: 'member', action: 'check' });
    expect(nextSteps(started, { id: OPR }, 'session-started')[0]).toMatchObject({ role: 'operator', action: 'form' });
    const linked = groupView({ ...b, group: { ...b.group, proTxHash: PROTX } }, 'testnet');
    expect(nextSteps(linked, { id: B })[0]).toMatchObject({ title: 'Registration linked', action: 'live' });
    expect(nextSteps(linked, { id: B }, 'live')[0]).toMatchObject({ tone: 'done', title: 'Live (verified)', action: 'live' });
    expect(nextSteps(linked, { id: OPR }, 'live')[0]!.title).toMatch(/keep the node running/);
    expect(nextSteps(linked, { id: id(77) }, 'live')[0]).toMatchObject({ role: 'visitor', action: 'live' });
    expect(nextSteps(linked, { id: B }, 'mismatch')[0]).toMatchObject({ tone: 'warn', action: 'live' });
    expect(nextSteps(linked, { id: B }, 'dissolved')[0]).toMatchObject({ tone: 'todo', action: 'refill' });
    // an organizer who co-owns gets one step, as a co-owner
    const own = groupView({ ...b, group: { ...b.group, ownerId: A, proTxHash: PROTX } }, 'testnet');
    expect(nextSteps(own, { id: A }, 'live').map((s) => s.role)).toEqual(['member']);
    expect(['form', 'check', 'live', 'refill', 'approve'].map((action) => stepHref({ action: action as never }, GID))).toEqual([`/g/${GID}/form`, `/g/${GID}/form#checker`, `/g/${GID}/live`, `/g/${GID}#refill`, `/g/${GID}`]);
  });

  it('reads a hash no node knows as linked, not as different terms', () => {
    const b = ready();
    const linked = groupView({ ...b, group: { ...b.group, proTxHash: PROTX } }, 'testnet');
    expect(stageOf(linked, { state: 'not-found', mnState: 'unknown' })).toBe('linked');
  });

  it('gives an organizer who runs the node one step after formation, as the operator', () => {
    const b = ready();
    const g = { ...b.group, ownerId: OPR, proTxHash: PROTX };
    const v = groupView({ ...b, group: g }, 'testnet');
    expect(v.operatorLed).toBe(true);
    for (const stage of ['session-started', 'linked', 'live'] as const) expect(nextSteps(v, { id: OPR }, stage).map((s) => s.role)).toEqual(['operator']);
  });

  it('keeps the coordinator’s session flag when a seat’s offers change', () => {
    expect(seatFlags(false, true, SEAT_FLAG.canCoordinate | SEAT_FLAG.sessionStarted)).toBe(SEAT_FLAG.votingKeyHolder | SEAT_FLAG.sessionStarted);
    expect(seatFlags(true, false)).toBe(SEAT_FLAG.canCoordinate);
  });
});

describe('matching (M4)', () => {
  const g1 = group({ id: id(31), roster: [{ id: A, amount: D(700) }], rewardBps: 1500, updatedAt: 5 });
  const g2 = group({ id: id(32), roster: [{ id: A, amount: D(400) }], rewardBps: 800, updatedAt: 4 });
  const g3 = group({ id: id(33), roster: [{ id: A, amount: D(850) }], updatedAt: 3 });
  const g4 = group({ id: id(34), roster: [{ id: A, amount: D(500) }], rewardBps: 800, updatedAt: 2 });

  it('ranks groups the amount fits: preferences met, then completing, then closest to full', () => {
    const me = looking(B, D(300), { maxRewardBps: 1000 });
    const ranked = rankGroups([g1, g2, g3, g4], me);
    expect(ranked.map((r) => r.group.id)).toEqual([g4.id, g2.id, g1.id]);
    expect(ranked[2]!.prefs.find((p) => !p.ok)!.text).toMatch(/above your 10%/);
    expect(ranked.find((r) => r.group.id === g1.id)!.completes).toBe(true);
  });

  it('suggests looking members who complete a group with me, skipping operator conflicts', () => {
    const me = looking(A, D(300), { operatorId: OPR, maxRewardBps: 1200 });
    const others = [looking(B, D(700)), looking(C, D(400), { operatorId: id(66) }), looking(id(40), D(350)), looking(id(41), D(350), { maxRewardBps: 900 })];
    const combos = combosWith(me, others);
    expect(combos.map((c) => c.people.map((p) => p.ownerId))).toEqual([[B], [id(40), id(41)]]);
    expect(combos[1]).toMatchObject({ operatorId: OPR, maxRewardBps: 900 });
  });

  it('shows the organizer who would fit and what completes the group', () => {
    const g = group({ roster: [{ id: A, amount: D(500) }], earlyPeriodBlocks: 52_416, earlyPenalty: D(120) });
    const posts = [looking(B, D(300)), looking(C, D(100)), looking(id(42), D(200)), looking(id(43), D(500)), looking(id(44), D(150))];
    const fits = lookingThatFits(g, posts, new Set([id(44)]));
    expect(fits.map((f) => f.looking.ownerId)).toEqual([id(43), B, id(42)]);
    expect(completions(g, fits).map((c) => c.map((l) => l.ownerId))).toEqual([[id(43)], [B, id(42)]]);
  });

  it('filters groups by amount, operator, reward and exit terms', () => {
    expect(filterGroups([g1, g2, g3], { amount: D(300) }).map((g) => g.id)).toEqual([g1.id, g2.id]);
    expect(filterGroups([g1, g2, g3], { maxRewardBps: 1000 }).map((g) => g.id)).toEqual([g2.id, g3.id]);
    expect(filterGroups([g1, group({ operatorId: null })], { operator: 'none' })).toHaveLength(1);
    expect(filterGroups([g1, group({ earlyPeriodBlocks: 104_832, earlyPenalty: D(5) })], { maxPeriodBlocks: 52_416 })).toEqual([g1]);
  });
});

describe('refill (M12)', () => {
  it('reopens with the same terms, needing only the leaver’s amount', () => {
    const old = group({ roster: [{ id: A, amount: D(500), label: 'Ana' }, { id: B, amount: D(300), label: 'Bo' }, { id: C, amount: D(200), label: 'Cy' }], status: GROUP_STATUS.dissolved, coordinatorId: B, votingHolderId: B, votingAddress: VOTING, lockedHash: 'ab'.repeat(32), termsRevision: 4, earlyPeriodBlocks: 52_416, earlyPenalty: D(20) });
    const f = refillFields(old, [B]);
    expect(f).toMatchObject({ refillOf: GID, termsRevision: 1, status: GROUP_STATUS.forming, lockedHash: undefined, coordinatorId: undefined, votingAddress: undefined, earlyPenalty: D(20), rewardBps: 1000 });
    expect(f.roster.map((r) => r.id)).toEqual([A, C]);
    expect(() => groupData(f, 'testnet')).not.toThrow();
    expect(OP_ACCEPT_STATUS.accepted).toBe(1);
  });
});
