import { describe, expect, test } from "vitest";
import { p2pkhScript, p2shScript } from "../src/address.ts";
import { COIN } from "../src/amounts.ts";
import { hash160 } from "../src/bytes.ts";
import {
  MAX_EARLY_PERIOD_BLOCKS,
  type ShareForRules,
  areEarlyTermsValid,
  areShareAmountsValid,
  canAddShare,
  minNextShare,
  isCompletable,
  isShareListTriviallyValid,
  remainingDuffs,
  suggestCombos,
} from "../src/rules.ts";

let counter = 0;
const newKey = () => hash160(Uint8Array.of(counter >> 8, counter++ & 0xff));
const newShare = (amount: bigint): ShareForRules => ({
  amount,
  scriptRefund: p2pkhScript(newKey()),
  scriptReward: new Uint8Array(),
  keyIDOwner: newKey(),
});

/** Port of BOOST_AUTO_TEST_CASE(share_list_validation), src/test/evo_sharedmn_tests.cpp:100-196 */
describe("IsShareListTriviallyValid (C++ share_list_validation cases)", () => {
  const voting = newKey();
  const check = (shares: ShareForRules[], period: number, penalty: bigint, expected?: string) => {
    const r = isShareListTriviallyValid(shares, period, penalty, voting);
    if (expected) expect(r).toMatchObject({ ok: false, reason: expected });
    else expect(r).toEqual({ ok: true });
  };
  const two = [newShare(600n * COIN), newShare(400n * COIN)];
  const eight = Array.from({ length: 8 }, () => newShare(125n * COIN));

  test("valid tables", () => {
    check(two, 0, 0n);
    check(two, MAX_EARLY_PERIOD_BLOCKS, 399n * COIN);
    check(eight, 100, 100n * COIN);
  });

  test("count bounds", () => {
    check([], 0, 0n, "bad-protx-shares-count");
    check([two[0]!], 0, 0n, "bad-protx-shares-count");
    check([...eight, newShare(125n * COIN)], 0, 0n, "bad-protx-shares-count");
  });

  test("early period cap and penalty bounds", () => {
    check(two, MAX_EARLY_PERIOD_BLOCKS + 1, 0n, "bad-protx-shares-early-period");
    check(two, 100, -1n, "bad-protx-shares-penalty");
    check(two, 100, 400n * COIN, "bad-protx-shares-penalty");
    check(two, 0, 1n, "bad-protx-shares-penalty");
    check(two, 100, 0n);
  });

  test("amount bounds and sum", () => {
    const s = structuredClone(two);
    s[0]!.amount = 99n * COIN;
    check(s, 0, 0n, "bad-protx-shares-amount");
    s[0]!.amount = 599n * COIN;
    check(s, 0, 0n, "bad-protx-shares-amount-sum");
    s[0]!.amount = 601n * COIN;
    check(s, 0, 0n, "bad-protx-shares-amount-sum");
  });

  test("duplicates: owner keys and refunds rejected, reward scripts allowed", () => {
    const k = structuredClone(two);
    k[1]!.keyIDOwner = k[0]!.keyIDOwner;
    check(k, 0, 0n, "bad-protx-shares-dup-key");
    const r = structuredClone(two);
    r[1]!.scriptRefund = r[0]!.scriptRefund;
    check(r, 0, 0n, "bad-protx-shares-dup-refund");
    const w = structuredClone(two);
    const reward = p2pkhScript(newKey());
    w[0]!.scriptReward = reward;
    w[1]!.scriptReward = reward;
    check(w, 0, 0n);
  });

  test("null owner key", () => {
    const s = structuredClone(two);
    s[0]!.keyIDOwner = new Uint8Array(20);
    check(s, 0, 0n, "bad-protx-shares-key-null");
  });

  test("script types: non-standard rejected, P2SH allowed", () => {
    const s = structuredClone(two);
    s[0]!.scriptReward = Uint8Array.of(0x51);
    check(s, 0, 0n, "bad-protx-shares-payee");
    s[0]!.scriptReward = p2shScript(hash160(Uint8Array.of(0x51)));
    check(s, 0, 0n);
  });

  test("refund/reward must not pay any owner key or the voting key", () => {
    const s = structuredClone(two);
    s[0]!.scriptReward = p2pkhScript(s[1]!.keyIDOwner);
    check(s, 0, 0n, "bad-protx-shares-payee-reuse");
    s[0]!.scriptReward = p2pkhScript(voting);
    check(s, 0, 0n, "bad-protx-shares-payee-reuse");
    // the same 20 bytes as P2SH are a different destination
    s[0]!.scriptReward = p2shScript(voting);
    check(s, 0, 0n);
    const own = structuredClone(two);
    own[0]!.scriptRefund = p2pkhScript(own[0]!.keyIDOwner);
    check(own, 0, 0n, "bad-protx-shares-payee-reuse");
  });

  test("evo collateral is data: 4000 DASH sums are checked against the given collateral", () => {
    expect(areShareAmountsValid([2000n * COIN, 2000n * COIN], 4000n * COIN)).toEqual({ ok: true });
    expect(areShareAmountsValid([2000n * COIN, 2000n * COIN])).toMatchObject({ reason: "bad-protx-shares-amount" });
  });

  test("early terms on their own", () => {
    expect(areEarlyTermsValid([500n * COIN, 500n * COIN], 52560, 5n * COIN)).toEqual({ ok: true });
    expect(areEarlyTermsValid([500n * COIN, 500n * COIN], 0, 5n * COIN)).toMatchObject({ ok: false });
    expect(areEarlyTermsValid([500n * COIN, 500n * COIN], 420481, 0n)).toMatchObject({ reason: "bad-protx-shares-early-period" });
  });
});

describe("matching helpers", () => {
  const D = (n: number) => BigInt(n) * COIN;

  test("remainingDuffs", () => {
    expect(remainingDuffs([])).toBe(D(1000));
    expect(remainingDuffs([D(500), D(300)])).toBe(D(200));
  });

  test("canAddShare: remainder 0 or >= 100 and completable under the cap", () => {
    expect(canAddShare([], D(500))).toEqual({ ok: true, remainingAfter: D(500) });
    expect(canAddShare([], D(1000))).toMatchObject({ ok: false, reason: "too-few-shares" });
    expect(canAddShare([], D(950))).toMatchObject({ ok: false, reason: "remainder-too-small" });
    expect(canAddShare([], D(99))).toMatchObject({ ok: false, reason: "below-minimum" });
    expect(canAddShare([D(500), D(300)], D(250))).toMatchObject({ ok: false, reason: "above-remaining" });
    expect(canAddShare([D(500), D(300)], D(150))).toMatchObject({ ok: false, reason: "remainder-too-small" });
    expect(canAddShare([D(500), D(300)], D(200))).toEqual({ ok: true, remainingAfter: 0n });
    expect(canAddShare([D(500), D(300)], D(100))).toEqual({ ok: true, remainingAfter: D(100) });
    expect(canAddShare([D(500)], D(400) + 1n)).toMatchObject({ ok: false, reason: "remainder-too-small" });
    const seven = Array.from({ length: 7 }, () => D(100));
    expect(canAddShare(seven, D(200))).toMatchObject({ ok: false, reason: "no-seat-for-remainder" });
    expect(canAddShare(seven, D(301))).toMatchObject({ ok: false, reason: "above-remaining" });
    expect(canAddShare(seven, D(300))).toEqual({ ok: true, remainingAfter: 0n });
    const six = Array.from({ length: 6 }, () => D(100));
    expect(canAddShare(six, D(100))).toEqual({ ok: true, remainingAfter: D(300) });
    expect(canAddShare([...six, D(100)], D(100))).toMatchObject({ ok: false, reason: "no-seat-for-remainder" });
    expect(canAddShare(Array.from({ length: 8 }, () => D(100)), D(100))).toMatchObject({ reason: "roster-full" });
  });

  test("the early penalty raises the smallest share still to come (penalty < smallest share)", () => {
    expect(minNextShare(0n)).toBe(D(100));
    expect(minNextShare(D(99))).toBe(D(100));
    expect(minNextShare(D(200))).toBe(D(200) + 1n);
    // [500, 350] with a 200 penalty: the only completion, 150, would be below the penalty
    expect(isCompletable(2, D(150), D(200))).toBe(false);
    expect(canAddShare([D(500)], D(350), undefined, D(200))).toMatchObject({ ok: false, reason: "remainder-too-small" });
    expect(canAddShare([D(500)], D(150), undefined, D(200))).toMatchObject({ ok: false, reason: "not-above-penalty" });
    expect(canAddShare([D(500)], D(250), undefined, D(200))).toEqual({ ok: true, remainingAfter: D(250) });
    // an empty roster can take any penalty two shares can stay above: 500/500 allows 499.99999999
    expect(isCompletable(0, D(1000), D(500) - 1n)).toBe(true);
    expect(isCompletable(0, D(1000), D(500))).toBe(false);
    expect(suggestCombos(D(500), [D(150), D(350), D(250), D(250)], 3, { earlyPenalty: D(200) })).toEqual([[2, 3]]);
  });

  test("isCompletable", () => {
    expect(isCompletable(0, D(1000))).toBe(true);
    expect(isCompletable(1, 0n)).toBe(false);
    expect(isCompletable(2, 0n)).toBe(true);
    expect(isCompletable(3, D(99))).toBe(false);
    expect(isCompletable(8, D(100))).toBe(false);
    expect(isCompletable(7, D(100))).toBe(true);
  });

  test("suggestCombos finds exact completions, fewest picks first, deterministic", () => {
    const cands = [D(100), D(300), D(200), D(100), D(500), D(50), D(250)];
    const combos = suggestCombos(D(300), cands, 3);
    expect(combos[0]).toEqual([1]);
    for (const c of combos) expect(c.reduce((a, i) => a + cands[i]!, 0n)).toBe(D(300));
    expect(combos.some((c) => c.includes(5))).toBe(false);
    expect(combos).toContainEqual([2, 0]);
    expect(combos).toContainEqual([2, 3]);
    expect(suggestCombos(D(300), cands, 3)).toEqual(combos);
    expect(suggestCombos(D(1000), [D(1000)], 8, { minPicks: 2 })).toEqual([]);
    expect(suggestCombos(D(1000), [D(500), D(500), D(1000)], 8, { minPicks: 2 })).toEqual([[0, 1]]);
    expect(suggestCombos(D(450), cands, 1)).toEqual([]);
    expect(suggestCombos(D(450), cands, 2)).toContainEqual([6, 2]);
  });

  test("suggestCombos stays bounded on large candidate pools", () => {
    const many = Array.from({ length: 400 }, (_, i) => D(100) + BigInt(i) * 1000n);
    const t0 = Date.now();
    const r = suggestCombos(D(700), many, 7, { maxResults: 5 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.length).toBeLessThanOrEqual(5);
    for (const c of r) expect(c.reduce((a, i) => a + many[i]!, 0n)).toBe(D(700));
  });
});
