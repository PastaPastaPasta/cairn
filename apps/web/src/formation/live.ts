// M11 computations: the owner reward split as consensus pays it, and the early period from the registered height.
import { type TermShare, earlyPeriodEndHeight, splitMasternodePayment } from '@cairn/shares';

/** Dash aims for a block every 2.5 minutes. */
export const BLOCKS_PER_DAY = 576;

export interface EarlyView {
  registeredHeight: number;
  /** First block at which leaving alone is free. */
  endHeight: number;
  blocksLeft: number;
  daysLeft: number;
  over: boolean;
  /** There never was an early period. */
  none: boolean;
}

export function earlyView(registeredHeight: number, earlyPeriodBlocks: number, tip: number): EarlyView {
  const endHeight = earlyPeriodEndHeight(registeredHeight, earlyPeriodBlocks);
  const blocksLeft = Math.max(0, endHeight - tip);
  return { registeredHeight, endHeight, blocksLeft, daysLeft: Math.round((blocksLeft / BLOCKS_PER_DAY) * 10) / 10, over: blocksLeft === 0, none: earlyPeriodBlocks === 0 };
}

/**
 * The agreed label of each registered share, by amount (the chain has no labels). An amount shared by several members cannot be
 * told apart from the chain alone: those shares read "A or B".
 */
export function labelChainShares(chainAmounts: readonly bigint[], terms: readonly TermShare[]): string[] {
  return chainAmounts.map((a) => {
    const same = terms.filter((t) => t.amount === a).map((t) => t.label);
    return same.length ? same.join(' or ') : 'not in the terms';
  });
}

export interface SplitRow {
  index: number;
  label: string;
  amount: bigint;
  /** Duffs this share receives from `reward`. */
  part: bigint;
  /** Fraction of the whole masternode payment. */
  fraction: number;
  mine: boolean;
}

/**
 * One masternode payment split as consensus pays it (SplitAmountByShares after the operator's cut). The operator's cut is paid only
 * once the operator has set a payout address with a service update; until then the owners keep it.
 */
export function rewardSplit(
  reward: bigint,
  operatorBps: number,
  shares: ReadonlyArray<{ amount: bigint }>,
  labels: readonly string[],
  o: { operatorPayoutSet?: boolean; mine?: string } = {},
): { operator: bigint; rows: SplitRow[] } {
  const { operator, owners } = splitMasternodePayment(reward, operatorBps, shares, o.operatorPayoutSet ?? true);
  return {
    operator,
    rows: shares.map((s, i) => ({
      index: i,
      label: labels[i] ?? `Share ${i + 1}`,
      amount: s.amount,
      part: owners[i]!,
      fraction: reward ? Number((owners[i]! * 1_000_000n) / reward) / 1_000_000 : 0,
      mine: !!o.mine && labels[i] === o.mine,
    })),
  };
}
