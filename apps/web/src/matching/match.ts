// Matching (DESIGN §4.1). There is one kind of listing, the group. A member says how much they can bring, and optionally the operator,
// the most reward and the longest early period they accept; every group still taking seats that their amount fits is ranked for them.
// Someone with no group to join starts one, alone: that group is how others find them, and organizers see such people as candidates.
// Amount rules are Dash Core's (canAddShare, suggestCombos); preferences rank and explain but never hide a group the amount fits.
import { GROUP_FLAG, GROUP_STATUS, type Group, type RosterEntry } from '@cairn/contract';
import { MAX_SHARES, REGULAR_COLLATERAL, suggestCombos } from '@cairn/shares';
import { fitsRoster } from './group.ts';
import { dash, pct } from './money.ts';
import { exitShort, periodWords } from './exit.ts';

/** What a member is looking for: their amount, and the terms they would accept (null: no preference). */
export interface Ask {
  amount: number;
  operatorId: string | null;
  maxRewardBps: number | null;
  maxPeriodBlocks: number | null;
}

export interface Preference {
  ok: boolean;
  /** Neither met nor missed: a difference worth knowing about. */
  note?: boolean;
  text: string;
}

/** How a group's terms meet what a member asked for, one line per preference they gave. */
export function preferences(g: Pick<Group, 'operatorId' | 'rewardBps' | 'earlyPeriodBlocks'>, ask: Ask): Preference[] {
  const out: Preference[] = [];
  if (ask.operatorId) out.push(g.operatorId === ask.operatorId ? { ok: true, text: 'Your chosen operator' } : { ok: false, text: g.operatorId ? 'A different operator' : 'Operator not chosen yet' });
  if (ask.maxRewardBps !== null)
    out.push(g.rewardBps <= ask.maxRewardBps ? { ok: true, text: `Operator reward ${pct(g.rewardBps)}, within your ${pct(ask.maxRewardBps)}` } : { ok: false, text: `Operator reward ${pct(g.rewardBps)}, above your ${pct(ask.maxRewardBps)}` });
  if (ask.maxPeriodBlocks !== null)
    out.push(
      g.earlyPeriodBlocks <= ask.maxPeriodBlocks
        ? { ok: true, text: g.earlyPeriodBlocks ? `Early period ${periodWords(g.earlyPeriodBlocks)}, within what you accept` : 'No early period' }
        : { ok: false, text: `Early period ${periodWords(g.earlyPeriodBlocks)}, longer than you accept` },
    );
  return out;
}

/** A group anyone may ask to join: still taking seats, and not filled by invitation only. */
const takesRequests = (g: Group) => g.status === GROUP_STATUS.forming && !!((g.flags ?? 0) & GROUP_FLAG.openAmounts);

export interface GroupFit {
  group: Group;
  /** Duffs still open once this amount is in. */
  remainingAfter: number;
  completes: boolean;
  prefs: Preference[];
  misses: number;
}

/**
 * Groups the amount fits (taking requests, and the roster can take it under Core's rules), best first: fewest unmet preferences, then
 * those it completes, then those it brings closest to 1000, then the newest. The member's own groups and those they are in are left out.
 */
export function rankGroups(groups: readonly Group[], ask: Ask, me: string | null = null): GroupFit[] {
  const out: GroupFit[] = [];
  for (const g of groups) {
    if (!takesRequests(g) || (me && (g.ownerId === me || g.roster.some((r) => r.id === me)))) continue;
    const fit = fitsRoster(g.roster, ask.amount, g.earlyPenalty);
    if (!fit.ok) continue;
    const prefs = preferences(g, ask);
    const remainingAfter = Number(fit.remainingAfter);
    out.push({ group: g, remainingAfter, completes: remainingAfter === 0, prefs, misses: prefs.filter((p) => !p.ok).length });
  }
  return out.sort((a, b) => a.misses - b.misses || Number(b.completes) - Number(a.completes) || a.remainingAfter - b.remainingAfter || (b.group.updatedAt ?? 0) - (a.group.updatedAt ?? 0));
}

/**
 * The one person in a group they started and are still alone in: someone waiting to be found. An operator's own node is not a person
 * waiting (they run it and would not move), and neither is a group that has stopped taking seats.
 */
export function startedAlone(g: Group): RosterEntry | null {
  if (g.status !== GROUP_STATUS.forming || g.roster.length !== 1) return null;
  const only = g.roster[0]!;
  return only.id === g.ownerId && g.operatorId !== g.ownerId ? only : null;
}

/**
 * Where a candidate's own group differs from the one inviting them. Only a different chosen operator is a conflict; reward and exit
 * terms are things to agree on (often just the defaults of a group started in one click), so they are notes, never a mark against.
 */
function differences(theirs: Group, ours: Pick<Group, 'operatorId' | 'rewardBps' | 'earlyPeriodBlocks' | 'earlyPenalty'>): Preference[] {
  const out: Preference[] = [];
  if (theirs.operatorId && theirs.operatorId !== ours.operatorId) out.push({ ok: false, text: 'Chose a different operator' });
  if (theirs.rewardBps !== ours.rewardBps) out.push({ ok: true, note: true, text: `Their group: ${pct(theirs.rewardBps)} operator reward` });
  if (theirs.earlyPeriodBlocks !== ours.earlyPeriodBlocks || theirs.earlyPenalty !== ours.earlyPenalty)
    out.push({ ok: true, note: true, text: theirs.earlyPeriodBlocks ? `Their group: ${exitShort(theirs.earlyPeriodBlocks, theirs.earlyPenalty)}` : 'Their group: no early-exit terms' });
  return out;
}

export interface Candidate {
  /** The person, and the amount they put into the group they started. */
  id: string;
  amount: number;
  /** The group they started, and are alone in. */
  group: Group;
  diffs: Preference[];
  completes: boolean;
}

/**
 * People waiting alone in a group they started whose amount the group `g` can take: whom its organizer can invite. Fewest
 * differences in terms first, then those who complete it, then the larger amounts.
 */
export function candidatesFor(g: Group, groups: readonly Group[], exclude: ReadonlySet<string> = new Set()): Candidate[] {
  const out: Candidate[] = [];
  for (const other of groups) {
    if (other.id === g.id) continue;
    const who = startedAlone(other);
    if (!who || exclude.has(who.id) || who.id === g.ownerId || g.roster.some((r) => r.id === who.id)) continue;
    const fit = fitsRoster(g.roster, who.amount, g.earlyPenalty);
    if (!fit.ok) continue;
    out.push({ id: who.id, amount: who.amount, group: other, diffs: differences(other, g), completes: fit.remainingAfter === 0n });
  }
  // one row per person, from their newest group
  const seen = new Set<string>();
  return out
    .sort((a, b) => (b.group.updatedAt ?? 0) - (a.group.updatedAt ?? 0))
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => a.diffs.filter((d) => !d.ok).length - b.diffs.filter((d) => !d.ok).length || Number(b.completes) - Number(a.completes) || b.amount - a.amount);
}

/** Sets of candidates that would complete the group's roster exactly (fewest people first). */
export function completions(g: Group, candidates: readonly Candidate[], maxResults = 3): Candidate[][] {
  const roster: readonly RosterEntry[] = g.roster;
  const remaining = REGULAR_COLLATERAL - roster.reduce((a, r) => a + BigInt(r.amount), 0n);
  if (remaining <= 0n) return [];
  return suggestCombos(
    remaining,
    candidates.map((c) => BigInt(c.amount)),
    MAX_SHARES - roster.length,
    { maxResults, earlyPenalty: BigInt(g.earlyPenalty), minPicks: roster.length ? 1 : 2 },
  ).map((idx) => idx.map((i) => candidates[i]!));
}

/** "With you, 850 of 1000 DASH" style words for a fit. */
export function fitWords(f: Pick<GroupFit, 'completes' | 'remainingAfter'>, amount: number): string {
  return f.completes ? `Your ${dash(amount)} completes it.` : `With you, ${dash(f.remainingAfter)} still to find.`;
}
