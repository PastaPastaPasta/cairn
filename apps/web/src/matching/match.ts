// Matching (DESIGN M4): which groups a member's amount fits, ranked by how well the group meets what they asked for, and which
// other looking members would complete a group with them. Amount rules are Dash Core's (canAddShare, suggestCombos); preferences
// (operator, reward, exit terms) rank and explain but never hide a group the amount fits.
import { LOOKING_STATUS, type Group, type Looking, type RosterEntry } from '@cairn/contract';
import { MAX_SHARES, REGULAR_COLLATERAL, suggestCombos } from '@cairn/shares';
import { fitsRoster } from './group.ts';
import { dash, pct } from './money.ts';
import { periodWords } from './exit.ts';

export interface Preference {
  ok: boolean;
  text: string;
}

/** How a group's terms meet a looking post's preferences, one line each. */
export function preferences(g: Pick<Group, 'operatorId' | 'rewardBps' | 'earlyPeriodBlocks' | 'earlyPenalty'>, l: Looking, whose: 'your' | 'their' = 'your'): Preference[] {
  const out: Preference[] = [];
  const they = whose === 'your' ? 'you' : 'they';
  if (l.operatorId) out.push(g.operatorId === l.operatorId ? { ok: true, text: `${whose === 'your' ? 'Your' : 'Their'} chosen operator` } : { ok: false, text: g.operatorId ? `A different operator than ${they} asked for` : 'Operator not chosen yet' });
  out.push(g.rewardBps <= l.maxRewardBps ? { ok: true, text: `Operator reward ${pct(g.rewardBps)}, within ${whose} ${pct(l.maxRewardBps)}` } : { ok: false, text: `Operator reward ${pct(g.rewardBps)}, above ${whose} ${pct(l.maxRewardBps)}` });
  const { maxPeriodBlocks: maxP, maxPenalty: maxPen } = l.earlyPref;
  const periodOk = maxP === null || g.earlyPeriodBlocks <= maxP;
  const penaltyOk = maxPen === null || g.earlyPenalty <= maxPen;
  if (maxP !== null || maxPen !== null)
    out.push(
      periodOk && penaltyOk
        ? { ok: true, text: `Exit terms ${they} accept` }
        : { ok: false, text: !periodOk ? `Early period ${periodWords(g.earlyPeriodBlocks)}, longer than ${they} accept` : `Early-exit penalty ${dash(g.earlyPenalty)}, more than ${they} accept` },
    );
  return out;
}

export interface GroupFit {
  group: Group;
  remainingAfter: number;
  completes: boolean;
  prefs: Preference[];
  misses: number;
}

/**
 * Groups `l`'s amount fits (forming, the roster can take it under Core's rules), best first: fewest unmet preferences, then those it
 * completes, then those it brings closest to 1000, then newest.
 */
export function rankGroups(groups: readonly Group[], l: Looking, exclude: ReadonlySet<string> = new Set()): GroupFit[] {
  const out: GroupFit[] = [];
  for (const g of groups) {
    if (exclude.has(g.id) || g.roster.some((r) => r.id === l.ownerId)) continue;
    const fit = fitsRoster(g.roster, l.amount, g.earlyPenalty);
    if (!fit.ok) continue;
    const prefs = preferences(g, l);
    const remainingAfter = Number(fit.remainingAfter);
    out.push({ group: g, remainingAfter, completes: remainingAfter === 0, prefs, misses: prefs.filter((p) => !p.ok).length });
  }
  return out.sort((a, b) => a.misses - b.misses || Number(b.completes) - Number(a.completes) || a.remainingAfter - b.remainingAfter || (b.group.updatedAt ?? 0) - (a.group.updatedAt ?? 0));
}

/** Two looking posts can share a group: neither insists on an operator the other excludes. */
const operatorsAgree = (a: Looking, b: Looking) => !a.operatorId || !b.operatorId || a.operatorId === b.operatorId;

export interface Combo {
  /** The other people, in the order suggestCombos picked them. */
  people: Looking[];
  /** The operator everyone accepts (a specific one when anyone asked for it), or null for "any". */
  operatorId: string | null;
  /** The largest operator reward everyone accepts. */
  maxRewardBps: number;
  /** The longest early period and largest penalty everyone accepts (null: any). */
  maxPeriodBlocks: number | null;
  maxPenalty: number | null;
}

const minOrNull = (xs: Array<number | null>): number | null => {
  const set = xs.filter((x): x is number => x !== null);
  return set.length ? Math.min(...set) : null;
};

function combine(me: Looking, people: Looking[]): Combo | null {
  const all = [me, ...people];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (!operatorsAgree(all[i]!, all[j]!)) return null;
  return {
    people,
    operatorId: all.find((l) => l.operatorId)?.operatorId ?? null,
    maxRewardBps: Math.min(...all.map((l) => l.maxRewardBps)),
    maxPeriodBlocks: minOrNull(all.map((l) => l.earlyPref.maxPeriodBlocks)),
    maxPenalty: minOrNull(all.map((l) => l.earlyPref.maxPenalty)),
  };
}

/**
 * Other open looking posts that, with `me`, add up to exactly 1000 DASH under Core's rules (fewest people first). Posts whose
 * operator choice conflicts with anyone's are left out.
 */
export function combosWith(me: Looking, others: readonly Looking[], maxResults = 5): Combo[] {
  const pool = others.filter((o) => o.ownerId !== me.ownerId && o.status === LOOKING_STATUS.open && operatorsAgree(me, o));
  const remaining = REGULAR_COLLATERAL - BigInt(me.amount);
  const picks = suggestCombos(
    remaining,
    pool.map((o) => BigInt(o.amount)),
    MAX_SHARES - 1,
    { maxResults: maxResults * 4 },
  );
  const out: Combo[] = [];
  for (const idx of picks) {
    const c = combine(
      me,
      idx.map((i) => pool[i]!),
    );
    if (c) out.push(c);
    if (out.length >= maxResults) break;
  }
  return out;
}

export interface LookingFit {
  looking: Looking;
  prefs: Preference[];
  misses: number;
  completes: boolean;
}

/** Looking members (not already in, asking or invited) whose amount the group's roster can take, best first. */
export function lookingThatFits(g: Group, posts: readonly Looking[], exclude: ReadonlySet<string>): LookingFit[] {
  return posts
    .filter((l) => l.status === LOOKING_STATUS.open && !exclude.has(l.ownerId) && l.ownerId !== g.ownerId && !g.roster.some((r) => r.id === l.ownerId))
    .flatMap((l) => {
      const fit = fitsRoster(g.roster, l.amount, g.earlyPenalty);
      if (!fit.ok) return [];
      const prefs = preferences(g, l, 'their');
      return [{ looking: l, prefs, misses: prefs.filter((p) => !p.ok).length, completes: fit.remainingAfter === 0n }];
    })
    .sort((a, b) => a.misses - b.misses || Number(b.completes) - Number(a.completes) || b.looking.amount - a.looking.amount);
}

/** Sets of fitting looking members that would complete the group's roster exactly (fewest people first). */
export function completions(g: Group, fits: readonly LookingFit[], maxResults = 3): Looking[][] {
  const roster: readonly RosterEntry[] = g.roster;
  const remaining = REGULAR_COLLATERAL - roster.reduce((a, r) => a + BigInt(r.amount), 0n);
  if (remaining <= 0n) return [];
  const pool = fits.map((f) => f.looking);
  return suggestCombos(
    remaining,
    pool.map((l) => BigInt(l.amount)),
    MAX_SHARES - roster.length,
    { maxResults, earlyPenalty: BigInt(g.earlyPenalty), minPicks: roster.length ? 1 : 2 },
  ).map((idx) => idx.map((i) => pool[i]!));
}

export interface GroupFilters {
  /** Duffs the viewer would bring: only groups that can take it. */
  amount?: number | null;
  /** 'any', 'none' (still to be chosen) or an operator id. */
  operator?: string;
  maxRewardBps?: number | null;
  /** Longest early period accepted, in blocks (null: any). */
  maxPeriodBlocks?: number | null;
}

export function filterGroups(groups: readonly Group[], f: GroupFilters): Group[] {
  return groups.filter((g) => {
    if (f.amount && !fitsRoster(g.roster, f.amount, g.earlyPenalty).ok) return false;
    if (f.operator && f.operator !== 'any' && (f.operator === 'none' ? !!g.operatorId : g.operatorId !== f.operator)) return false;
    if (f.maxRewardBps !== undefined && f.maxRewardBps !== null && g.rewardBps > f.maxRewardBps) return false;
    if (f.maxPeriodBlocks !== undefined && f.maxPeriodBlocks !== null && g.earlyPeriodBlocks > f.maxPeriodBlocks) return false;
    return true;
  });
}
