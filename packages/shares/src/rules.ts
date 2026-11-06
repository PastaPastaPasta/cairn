import { COIN } from "./amounts.ts";
import { parseStandardScript } from "./address.ts";
import { type Bytes, bytesToHex, equalBytes } from "./bytes.ts";

/** CProRegTx::MIN_SHARES / MAX_SHARES (src/evo/providertx.h) */
export const MIN_SHARES = 2;
export const MAX_SHARES = 8;
/** CCollateralShare::MIN_AMOUNT: 100 DASH */
export const MIN_SHARE_AMOUNT = 100n * COIN;
/** dmn_types::Regular.collat_amount */
export const REGULAR_COLLATERAL = 1000n * COIN;
/** dmn_types::Evo.collat_amount (shared EvoNodes need evo_shares, which no release signals yet) */
export const EVO_COLLATERAL = 4000n * COIN;
/** CProRegTx::MAX_EARLY_PERIOD_BLOCKS: about two years of 2.5-minute blocks */
export const MAX_EARLY_PERIOD_BLOCKS = 420480;
/** nOperatorReward is in basis points, 0..10000 (CProRegTx::IsTriviallyValid) */
export const MAX_OPERATOR_REWARD_BPS = 10000;

/** Core's reject reasons for share-table rules */
export type ShareRuleReason =
  | "bad-protx-shares-count"
  | "bad-protx-shares-amount"
  | "bad-protx-shares-amount-sum"
  | "bad-protx-shares-early-period"
  | "bad-protx-shares-penalty"
  | "bad-protx-shares-key-null"
  | "bad-protx-shares-dup-key"
  | "bad-protx-shares-dup-refund"
  | "bad-protx-shares-payee"
  | "bad-protx-shares-payee-dest"
  | "bad-protx-shares-payee-reuse";

export type RuleResult = { ok: true } | { ok: false; reason: ShareRuleReason; message: string };

const OK: RuleResult = { ok: true };

function fail(reason: ShareRuleReason, message: string): RuleResult {
  return { ok: false, reason, message };
}

/** AreShareAmountsValid (src/evo/providertx.cpp:80-97): 2..8 shares, each in [100 DASH, collateral], sum == collateral */
export function areShareAmountsValid(amounts: readonly bigint[], collateral: bigint = REGULAR_COLLATERAL): RuleResult {
  if (amounts.length < MIN_SHARES || amounts.length > MAX_SHARES) {
    return fail("bad-protx-shares-count", `A shared masternode needs between ${MIN_SHARES} and ${MAX_SHARES} shares.`);
  }
  let total = 0n;
  for (const a of amounts) {
    if (a < MIN_SHARE_AMOUNT || a > collateral) {
      return fail("bad-protx-shares-amount", "Every share must be at least 100 DASH and at most the whole collateral.");
    }
    total += a;
  }
  if (total !== collateral) {
    return fail("bad-protx-shares-amount-sum", "The shares must add up to exactly the collateral.");
  }
  return OK;
}

/** IsEarlyPenaltyValid (src/evo/providertx.cpp:64-78): 0 <= penalty < smallest share; penalty 0 when there is no early period */
export function isEarlyPenaltyValid(earlyPeriodBlocks: number, earlyPenalty: bigint, minShareAmount: bigint): RuleResult {
  if (earlyPenalty < 0n || earlyPenalty >= minShareAmount) {
    return fail("bad-protx-shares-penalty", "The early-exit penalty must be below the smallest share.");
  }
  if (earlyPeriodBlocks === 0 && earlyPenalty !== 0n) {
    return fail("bad-protx-shares-penalty", "Set the early-exit penalty to 0 when there is no early period.");
  }
  return OK;
}

/** The early-period cap IsShareListTriviallyValid applies */
export function isEarlyPeriodValid(earlyPeriodBlocks: number): RuleResult {
  if (!Number.isInteger(earlyPeriodBlocks) || earlyPeriodBlocks < 0 || earlyPeriodBlocks > MAX_EARLY_PERIOD_BLOCKS) {
    return fail("bad-protx-shares-early-period", `The early period must be 0 to ${MAX_EARLY_PERIOD_BLOCKS} blocks (about two years).`);
  }
  return OK;
}

/** Early terms on their own: the period cap, then the penalty rules against the smallest share */
export function areEarlyTermsValid(amounts: readonly bigint[], earlyPeriodBlocks: number, earlyPenalty: bigint): RuleResult {
  const period = isEarlyPeriodValid(earlyPeriodBlocks);
  if (!period.ok) return period;
  return isEarlyPenaltyValid(earlyPeriodBlocks, earlyPenalty, minAmount(amounts));
}

/** Smallest amount (0 for an empty list) */
export function minAmount(amounts: readonly bigint[]): bigint {
  let m: bigint | undefined;
  for (const a of amounts) if (m === undefined || a < m) m = a;
  return m ?? 0n;
}

export interface ShareForRules {
  amount: bigint;
  scriptRefund: Bytes;
  /** empty = rewards to the refund script */
  scriptReward: Bytes;
  keyIDOwner: Bytes;
}

/**
 * IsShareListTriviallyValid (src/evo/providertx.cpp:99-150), in the same check order:
 * amounts, early-period cap, then per share: non-null distinct owner keys, distinct refund
 * scripts, P2PKH/P2SH refund and (non-empty) reward scripts that pay neither the voting key
 * nor any share's owner key; finally the penalty rules.
 */
export function isShareListTriviallyValid(
  shares: readonly ShareForRules[],
  earlyPeriodBlocks: number,
  earlyPenalty: bigint,
  keyIDVoting: Bytes,
  collateral: bigint = REGULAR_COLLATERAL,
): RuleResult {
  const amounts = shares.map((s) => s.amount);
  const amountCheck = areShareAmountsValid(amounts, collateral);
  if (!amountCheck.ok) return amountCheck;
  const period = isEarlyPeriodValid(earlyPeriodBlocks);
  if (!period.ok) return period;

  const ownerKeys = new Set<string>();
  const refunds = new Set<string>();
  for (const share of shares) {
    if (share.keyIDOwner.every((b) => b === 0)) {
      return fail("bad-protx-shares-key-null", "Every share needs its own owner address.");
    }
    const ownerHex = bytesToHex(share.keyIDOwner);
    if (ownerKeys.has(ownerHex)) return fail("bad-protx-shares-dup-key", "Every share needs its own owner address.");
    ownerKeys.add(ownerHex);
    const refundHex = bytesToHex(share.scriptRefund);
    if (refunds.has(refundHex)) return fail("bad-protx-shares-dup-refund", "Every refund address must be unique.");
    refunds.add(refundHex);

    for (const [script, isReward] of [
      [share.scriptRefund, false],
      [share.scriptReward, true],
    ] as const) {
      if (isReward && script.length === 0) continue;
      const standard = parseStandardScript(script);
      if (!standard) {
        return fail("bad-protx-shares-payee", "Every refund and reward address must be a P2PKH or P2SH address.");
      }
      const pkh = standard.type === "p2pkh" ? standard.hash : undefined;
      if (pkh && (equalBytes(pkh, keyIDVoting) || shares.some((o) => equalBytes(pkh, o.keyIDOwner)))) {
        return fail(
          "bad-protx-shares-payee-reuse",
          "A refund or reward address must not be the voting address or any share's owner address.",
        );
      }
    }
  }
  return isEarlyPenaltyValid(earlyPeriodBlocks, earlyPenalty, minAmount(amounts));
}

export function isOperatorRewardValid(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MAX_OPERATOR_REWARD_BPS;
}

// ---- Matching helpers (not consensus rules; they keep a forming roster completable)

/** What the roster still needs to reach the collateral (negative if over-subscribed) */
export function remainingDuffs(rosterAmounts: readonly bigint[], collateral: bigint = REGULAR_COLLATERAL): bigint {
  return rosterAmounts.reduce((acc, a) => acc - a, collateral);
}

/**
 * Whether a roster with `count` shares and `remaining` still to fill can become a valid table:
 * either it is already complete with at least MIN_SHARES shares, or the remainder is at least
 * one minimum share and a seat is left for it. (A remainder >= 100 DASH can always be a single
 * share, so one free seat is enough.)
 */
export function isCompletable(count: number, remaining: bigint): boolean {
  if (count > MAX_SHARES || remaining < 0n) return false;
  if (remaining === 0n) return count >= MIN_SHARES;
  return remaining >= MIN_SHARE_AMOUNT && count < MAX_SHARES;
}

export type CanAddReason =
  | "below-minimum"
  | "above-remaining"
  | "roster-full"
  | "remainder-too-small"
  | "no-seat-for-remainder"
  | "too-few-shares";

export type CanAddResult = { ok: true; remainingAfter: bigint } | { ok: false; reason: CanAddReason; message: string };

/**
 * Can `amount` join the roster? It must be a valid share (>= 100 DASH, within what is left), and
 * what remains afterwards must be 0 (with at least two shares in total) or >= 100 DASH with a
 * seat left under the 8-share cap.
 */
export function canAddShare(
  rosterAmounts: readonly bigint[],
  amount: bigint,
  collateral: bigint = REGULAR_COLLATERAL,
): CanAddResult {
  const remaining = remainingDuffs(rosterAmounts, collateral);
  if (rosterAmounts.length >= MAX_SHARES) {
    return { ok: false, reason: "roster-full", message: `The group already has ${MAX_SHARES} shares.` };
  }
  if (amount < MIN_SHARE_AMOUNT) {
    return { ok: false, reason: "below-minimum", message: "A share must be at least 100 DASH." };
  }
  if (amount > remaining) {
    return { ok: false, reason: "above-remaining", message: "That is more than the group still needs." };
  }
  const after = remaining - amount;
  const count = rosterAmounts.length + 1;
  if (after === 0n) {
    if (count < MIN_SHARES) {
      return { ok: false, reason: "too-few-shares", message: "A shared masternode needs at least two shares." };
    }
    return { ok: true, remainingAfter: 0n };
  }
  if (after < MIN_SHARE_AMOUNT) {
    return {
      ok: false,
      reason: "remainder-too-small",
      message: "That would leave less than 100 DASH for the last share; nobody could complete the group.",
    };
  }
  if (count >= MAX_SHARES) {
    return {
      ok: false,
      reason: "no-seat-for-remainder",
      message: `That would fill all ${MAX_SHARES} seats without reaching the full collateral.`,
    };
  }
  return { ok: true, remainingAfter: after };
}

export interface SuggestOptions {
  /** Minimum picks in a combination (default 1). Use 2 for an empty roster: one share cannot be a whole table. */
  minPicks?: number;
  /** Stop after this many combinations (default 20) */
  maxResults?: number;
  /** Search budget in visited nodes, to bound worst cases (default 200000) */
  maxSteps?: number;
}

/**
 * Sets of candidates (indices into `candidateAmounts`) whose amounts sum to exactly `remaining`,
 * using at most `maxPicks` of them. Each candidate is used at most once; candidates below
 * 100 DASH are ignored. Results are ordered by fewest picks, then by larger amounts first, and
 * are deterministic. Pass maxPicks = MAX_SHARES - rosterSize to respect the 8-share cap.
 */
export function suggestCombos(
  remaining: bigint,
  candidateAmounts: readonly bigint[],
  maxPicks: number,
  opts: SuggestOptions = {},
): number[][] {
  const minPicks = Math.max(1, opts.minPicks ?? 1);
  const maxResults = opts.maxResults ?? 20;
  let steps = opts.maxSteps ?? 200_000;
  const picks = Math.min(maxPicks, MAX_SHARES);
  if (remaining <= 0n || picks < minPicks) return [];

  const order = candidateAmounts
    .map((amount, index) => ({ amount, index }))
    .filter((c) => c.amount >= MIN_SHARE_AMOUNT && c.amount <= remaining)
    .sort((a, b) => (a.amount === b.amount ? a.index - b.index : a.amount > b.amount ? -1 : 1));

  const results: number[][] = [];
  const seen = new Set<string>();
  // Iterative deepening yields fewest-picks combinations first
  for (let size = minPicks; size <= picks && results.length < maxResults; size++) {
    const chosen: number[] = [];
    const dfs = (start: number, left: bigint): void => {
      if (results.length >= maxResults || steps <= 0) return;
      const slots = size - chosen.length;
      if (slots === 0) {
        if (left === 0n) {
          const combo = chosen.map((i) => order[i]!.index);
          // Equal amounts are interchangeable for the table but not for the people; keep both, but
          // drop exact duplicates of the same index set
          const key = [...combo].sort((a, b) => a - b).join(",");
          if (!seen.has(key)) {
            seen.add(key);
            results.push(combo);
          }
        }
        return;
      }
      for (let i = start; i <= order.length - slots; i++) {
        if (--steps <= 0) return;
        const a = order[i]!.amount;
        if (a > left) continue;
        // amounts are descending: if `slots` copies of this one cannot reach `left`, nothing later can
        if (a * BigInt(slots) < left) return;
        chosen.push(i);
        dfs(i + 1, left - a);
        chosen.pop();
        if (results.length >= maxResults) return;
      }
    };
    dfs(0, remaining);
  }
  return results;
}
