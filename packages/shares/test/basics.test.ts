import { describe, expect, test } from "vitest";
import {
  addressToKeyId,
  addressToScript,
  decodeAddress,
  encodeAddress,
  isValidAddress,
  p2pkhScript,
  p2shScript,
  parseStandardScript,
  scriptToAddress,
} from "../src/address.ts";
import { AmountError, COIN, dash, formatDash, parseDash } from "../src/amounts.ts";
import { hexToBytes } from "../src/bytes.ts";
import {
  earlyPeriodEndHeight,
  isEarlyAt,
  operatorReward,
  penaltyBonuses,
  proRataFloor,
  splitMasternodePayment,
  splitOwnerReward,
} from "../src/rewards.ts";

describe("amounts", () => {
  test("parse is exact, no floats", () => {
    expect(parseDash("1000")).toBe(1000n * COIN);
    expect(parseDash("0.1")).toBe(10_000_000n);
    expect(parseDash("0.00000001")).toBe(1n);
    expect(parseDash("123.45678901")).toBe(12_345_678_901n);
    expect(parseDash(" 12.5 ")).toBe(1_250_000_000n);
    // 0.1 + 0.2 style float traps
    expect(parseDash("0.3")).toBe(parseDash("0.1") + parseDash("0.2"));
    expect(parseDash("-1", { allowNegative: true })).toBe(-COIN);
  });

  test("parse rejects malformed and over-precise input", () => {
    for (const bad of ["", "1.", ".5", "1e3", "1,000", "0.000000001", "abc", "-1", "+1", "1 000"]) {
      expect(() => parseDash(bad), bad).toThrow(AmountError);
    }
  });

  test("format trims zeros, groups, units", () => {
    expect(formatDash(1000n * COIN)).toBe("1000");
    expect(formatDash(1_250_000_000n)).toBe("12.5");
    expect(formatDash(1n)).toBe("0.00000001");
    expect(formatDash(-150_000_000n)).toBe("-1.5");
    expect(formatDash(5n * COIN, { minDecimals: 2 })).toBe("5.00");
    expect(formatDash(123456789n * COIN, { groupSeparator: "," , unit: "DASH" })).toBe("123,456,789 DASH");
    expect(dash(100)).toBe(10_000_000_000n);
    for (const d of [0n, 1n, 99_999_999n, 100_000_001n, 21_000_000n * COIN]) expect(parseDash(formatDash(d))).toBe(d);
  });
});

describe("address", () => {
  const h = hexToBytes("4412220e39d5a7032c3b2de372c1ac102dbf21c3");
  test("version bytes: mainnet X/7, testnet-family y/8", () => {
    expect(encodeAddress(h, "p2pkh", "main")[0]).toBe("X");
    expect(encodeAddress(h, "p2sh", "main")[0]).toBe("7");
    for (const n of ["test", "devnet", "regtest"] as const) {
      expect(encodeAddress(h, "p2pkh", n)[0]).toBe("y");
      expect(encodeAddress(h, "p2sh", n)[0]).toBe("8");
    }
  });

  test("round trips and network enforcement", () => {
    const main = encodeAddress(h, "p2pkh", "main");
    const test_ = encodeAddress(h, "p2pkh", "test");
    expect(decodeAddress(main)).toEqual({ type: "p2pkh", hash: h, family: "main" });
    expect(decodeAddress(test_, "regtest")).toEqual({ type: "p2pkh", hash: h, family: "test" });
    expect(decodeAddress(main, "test")).toBeUndefined();
    expect(isValidAddress(test_, "main")).toBe(false);
    expect(isValidAddress(test_, "test", "p2sh")).toBe(false);
    expect(addressToKeyId(encodeAddress(h, "p2sh", "test"), "test")).toBeUndefined();
  });

  test("checksum and length are enforced", () => {
    const a = encodeAddress(h, "p2pkh", "test");
    const flipped = a.slice(0, -1) + (a.endsWith("1") ? "2" : "1");
    expect(decodeAddress(flipped)).toBeUndefined();
    expect(decodeAddress(a + "1")).toBeUndefined();
    expect(decodeAddress("")).toBeUndefined();
    expect(decodeAddress("0OIl")).toBeUndefined();
  });

  test("script <-> address, exact templates only", () => {
    const pkh = p2pkhScript(h);
    const sh = p2shScript(h);
    expect(scriptToAddress(pkh, "test")).toBe(encodeAddress(h, "p2pkh", "test"));
    expect(scriptToAddress(sh, "main")).toBe(encodeAddress(h, "p2sh", "main"));
    expect(addressToScript(encodeAddress(h, "p2sh", "devnet"), "devnet")).toEqual(sh);
    expect(parseStandardScript(Uint8Array.of(...pkh, 0x61))).toBeUndefined();
    expect(parseStandardScript(hexToBytes("04445348437551"))).toBeUndefined();
    expect(parseStandardScript(Uint8Array.of(0x51))).toBeUndefined();
  });

  test("real regtest/testnet addresses from Core decode to the scripts Core reported", () => {
    // protx info, regtest masternode A share 0
    expect(scriptToAddress(hexToBytes("76a91469a399071c7e4bf5fdc5aad6b318e9ea74908ab488ac"), "regtest")).toBe(
      "yVx1nKMPZ8aCuRFMF29hTYesrxKXiNex8v",
    );
    expect(decodeAddress("8wFfLF4ajJjQDgLZi5BLmAA2nF2sVU6Gkr", "regtest")?.type).toBe("p2sh");
  });
});

describe("rewards", () => {
  const COINn = 100_000_000n;
  test("SplitAmountByShares vectors from src/test/evo_sharedmn_tests.cpp", () => {
    const shares = [600n * COINn, 300n * COINn, 100n * COINn];
    const total = 123456789n;
    const a = splitOwnerReward(total, shares);
    expect(a[0]! + a[1]! + a[2]!).toBe(total);
    expect(a[0]).toBe((total * 6n) / 10n);
    expect(a[1]).toBe((total * 3n) / 10n);
    expect(a[2]).toBe(total - a[0]! - a[1]!);
    const big = splitOwnerReward(566n * COINn, shares);
    expect(big.reduce((x, y) => x + y, 0n)).toBe(566n * COINn);
    expect(big[0]).toBe((566n * COINn * 6n) / 10n);
  });

  test("remainder goes to the last share; zero total; 8 shares", () => {
    expect(splitOwnerReward(10n, [{ amount: 1n }, { amount: 1n }, { amount: 1n }])).toEqual([3n, 3n, 4n]);
    expect(splitOwnerReward(0n, [5n, 5n])).toEqual([0n, 0n]);
    const eight = [300n, 100n, 100n, 100n, 100n, 100n, 100n, 100n].map((x) => x * COINn);
    const s = splitOwnerReward(234375000n, eight);
    expect(s.reduce((x, y) => x + y, 0n)).toBe(234375000n);
    expect(s[0]).toBe(70312500n);
  });

  test("operator cut only with a payout address; integer division", () => {
    expect(operatorReward(1_000_000n, 500)).toBe(50_000n);
    expect(operatorReward(1_000_000n, 500, false)).toBe(0n);
    expect(operatorReward(999n, 1)).toBe(0n);
    expect(operatorReward(1_000_000n, 10000)).toBe(1_000_000n);
    const p = splitMasternodePayment(1_000_000n, 1250, [500n, 300n, 200n]);
    expect(p.operator).toBe(125_000n);
    expect(p.owners).toEqual([437_500n, 262_500n, 175_000n]);
  });

  test("early period end and penalty bonuses (CheckProDisTxForList)", () => {
    expect(earlyPeriodEndHeight(1_583_318, 52_560)).toBe(1_635_878);
    expect(isEarlyAt(1_635_877, 1_583_318, 52_560)).toBe(true);
    expect(isEarlyAt(1_635_878, 1_583_318, 52_560)).toBe(false);
    expect(isEarlyAt(100, 100, 0)).toBe(false);
    expect(penaltyBonuses(500_000_000n, [500n, 300n, 200n].map((x) => x * COINn), 0)).toEqual([0n, 300_000_000n, 200_000_000n]);
    expect(proRataFloor(7n, 1n, 3n)).toBe(2n);
  });
});
