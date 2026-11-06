/**
 * ProRataFloor (src/evo/providertx_util.cpp): floor(total * weight / weightTotal), computed in
 * Core with a 256-bit intermediate; bigint is exact.
 */
export function proRataFloor(total: bigint, weight: bigint, weightTotal: bigint): bigint {
  if (weightTotal <= 0n) throw new RangeError("weight total must be positive");
  return (total * weight) / weightTotal;
}

/**
 * SplitAmountByShares (src/evo/providertx_util.cpp:99-115): every share but the last gets
 * floor(total * amount / sum), the last share gets the remainder, so the split sums to `total`.
 * Consensus omits zero outputs when paying (src/masternode/payments.cpp:252-261).
 */
export function splitOwnerReward(total: bigint, shares: readonly { amount: bigint }[] | readonly bigint[]): bigint[] {
  const weights = shares.map((s) => (typeof s === "bigint" ? s : s.amount));
  const weightTotal = weights.reduce((a, b) => a + b, 0n);
  const out: bigint[] = [];
  let paid = 0n;
  weights.forEach((w, i) => {
    const payout = i + 1 === weights.length ? total - paid : proRataFloor(total, w, weightTotal);
    paid += payout;
    out.push(payout);
  });
  return out;
}

/**
 * Operator cut of a masternode payment (src/masternode/payments.cpp:244-249):
 * mnReward * bps / 10000, and only once the operator has set a payout address with
 * ProUpServTx; otherwise the owners keep it.
 */
export function operatorReward(masternodeReward: bigint, operatorRewardBps: number, operatorPayoutSet = true): bigint {
  if (!operatorPayoutSet || operatorRewardBps === 0) return 0n;
  return (masternodeReward * BigInt(operatorRewardBps)) / 10000n;
}

/** The full payout of one masternode payment: operator cut first, then the owner split by share */
export function splitMasternodePayment(
  masternodeReward: bigint,
  operatorRewardBps: number,
  shares: readonly { amount: bigint }[] | readonly bigint[],
  operatorPayoutSet = true,
): { operator: bigint; owners: bigint[] } {
  const op = operatorReward(masternodeReward, operatorRewardBps, operatorPayoutSet);
  return { operator: op, owners: splitOwnerReward(masternodeReward - op, shares) };
}

/**
 * First height at which leaving costs no penalty. A dissolution mined at height h is "early"
 * while h - registeredHeight < earlyPeriodBlocks (CheckProDisTxForList), so the penalty-free
 * height is registeredHeight + earlyPeriodBlocks.
 */
export function earlyPeriodEndHeight(registeredHeight: number, earlyPeriodBlocks: number): number {
  return registeredHeight + earlyPeriodBlocks;
}

export function isEarlyAt(spendHeight: number, registeredHeight: number, earlyPeriodBlocks: number): boolean {
  return spendHeight - registeredHeight < earlyPeriodBlocks;
}

/**
 * Minimum each non-actor share receives in a penalty-paying unilateral dissolution:
 * principal + floor(penalty * amount_i / nonActorTotal) (CheckProDisTxForList).
 */
export function penaltyBonuses(earlyPenalty: bigint, shares: readonly bigint[], actorIndex: number): bigint[] {
  const nonActorTotal = shares.reduce((a, s, i) => (i === actorIndex ? a : a + s), 0n);
  return shares.map((s, i) => (i === actorIndex || nonActorTotal === 0n ? 0n : proRataFloor(earlyPenalty, s, nonActorTotal)));
}
