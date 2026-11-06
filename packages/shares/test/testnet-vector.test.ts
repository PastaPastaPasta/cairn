import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { keyIdToAddress, scriptToAddress } from "../src/address.ts";
import { bytesToHex, hexToBytes } from "../src/bytes.ts";
import { recoverCompact, sharedRegConsentHash, verifyCompactCanonical, verifyJoinSigs } from "../src/consent.ts";
import { coreP2PEntries, isNetInfoEmpty } from "../src/netinfo.ts";
import { decodeSharedProRegTx, encodeProRegTxPayload } from "../src/proregtx.ts";
import { encodeTxHex } from "../src/tx.ts";

const HEX = readFileSync(new URL("./vectors/testnet-d400c120.hex", import.meta.url), "utf8").trim();
const TXID = "d400c12078251aa1320315a683291667beb3b585a5e0c2609919df27aab674e6";

describe("real testnet shared ProRegTx d400c120 (Qt wizard, 500/300/200)", () => {
  const d = decodeSharedProRegTx(HEX);

  test("txid and byte-exact round trip", () => {
    expect(d.txid).toBe(TXID);
    expect(encodeTxHex(d.tx)).toBe(HEX);
    expect(bytesToHex(encodeProRegTxPayload(d.payload))).toBe(bytesToHex(d.tx.extraPayload));
  });

  test("wizard layout: change outputs first, 1000 DASH template last, final sequences, nLockTime 0", () => {
    expect(d.tx.version).toBe(3);
    expect(d.tx.type).toBe(1);
    expect(d.tx.lockTime).toBe(0);
    expect(d.tx.vin).toHaveLength(3);
    expect(d.tx.vin.every((i) => i.sequence === 0xffffffff && i.scriptSig.length > 0)).toBe(true);
    expect(d.collateralIndex).toBe(3);
    expect(d.tx.vout.map((o) => o.value)).toEqual([399899550n, 50000000n, 50000000n, 100000000000n]);
    expect(bytesToHex(d.tx.vout[3]!.script)).toBe("04445348437551");
  });

  test("payload terms", () => {
    const p = d.payload;
    expect(p.version).toBe(3);
    expect(p.mnType).toBe(0);
    expect(p.mode).toBe(0);
    expect(p.collateralOutpoint).toEqual({ txid: "0".repeat(64), vout: 3 });
    expect(bytesToHex(p.keyIDOwner)).toBe("0".repeat(40));
    expect(p.payouts).toEqual([]);
    expect(p.operatorReward).toBe(300);
    expect(p.earlyPeriodBlocks).toBe(52560);
    expect(p.earlyPenalty).toBe(500000000n);
    expect(isNetInfoEmpty(p.netInfo)).toBe(true);
    expect(coreP2PEntries(p.netInfo)).toEqual([]);
    expect(p.vchSig).toHaveLength(0);
    expect(p.shares.map((s) => s.amount)).toEqual([50000000000n, 30000000000n, 20000000000n]);
    expect(p.shares.map((s) => bytesToHex(s.keyIDOwner))).toEqual([
      "4412220e39d5a7032c3b2de372c1ac102dbf21c3",
      "2918436b02b5f0bb882525be98c4b95d16d47761",
      "ddf7b3b70818bff7ceeaf36a9b5cc08217014032",
    ]);
    expect(bytesToHex(p.shares[0]!.scriptReward)).toBe("76a91409a70500fb7388215fa644e1a3e9e6dba5fc104088ac");
    expect(p.shares[1]!.scriptReward).toHaveLength(0);
    for (const s of p.shares) expect(scriptToAddress(s.scriptRefund, "test")?.startsWith("y")).toBe(true);
    expect(keyIdToAddress(p.shares[0]!.keyIDOwner, "test").startsWith("y")).toBe(true);
  });

  test("consent hash recomputes and all 3 joinSigs recover their share's owner key", () => {
    const { consentHash, results } = verifyJoinSigs(d.tx, d.payload);
    expect(consentHash.hex).toBe("9125ad7df72d0b591cefd4f8108c221dafc513f855c236039f8f0d636452158d");
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    results.forEach((r, i) => expect(bytesToHex(r.recoveredKeyId!)).toBe(bytesToHex(d.payload.shares[i]!.keyIDOwner)));
  });

  test("the signed digest is the internal byte order; the displayed (reversed) order does not verify", () => {
    const h = sharedRegConsentHash(d.tx, d.payload);
    const sig = d.payload.joinSigs[0]!;
    const owner = d.payload.shares[0]!.keyIDOwner;
    expect(verifyCompactCanonical(h.bytes, owner, sig).ok).toBe(true);
    expect(verifyCompactCanonical(hexToBytes(h.hex), owner, sig).ok).toBe(false);
  });

  test("every covered byte matters: tampering breaks consent", () => {
    const tampered = structuredClone(d);
    tampered.tx.vout[0]!.value += 1n;
    expect(verifyJoinSigs(tampered.tx, d.payload).results.some((r) => r.ok)).toBe(false);
    const p2 = structuredClone(d.payload);
    p2.earlyPenalty = 0n;
    expect(verifyJoinSigs(d.tx, p2).results.some((r) => r.ok)).toBe(false);
    const p3 = structuredClone(d.payload);
    p3.shares[2]!.amount -= 1n;
    expect(verifyJoinSigs(d.tx, p3).results.some((r) => r.ok)).toBe(false);
    const t4 = structuredClone(d);
    t4.tx.vin[1]!.sequence = 0xfffffffe;
    expect(verifyJoinSigs(t4.tx, d.payload).results.some((r) => r.ok)).toBe(false);
    // scriptSigs are not covered
    const t5 = structuredClone(d);
    t5.tx.vin[0]!.scriptSig = new Uint8Array();
    expect(verifyJoinSigs(t5.tx, d.payload).results.every((r) => r.ok)).toBe(true);
  });

  test("canonical-signature rules: header aliases and high-S are refused, as VerifyHashCanonical does", () => {
    const h = sharedRegConsentHash(d.tx, d.payload).bytes;
    const owner = d.payload.shares[1]!.keyIDOwner;
    const sig = d.payload.joinSigs[1]!;
    const aliased = Uint8Array.from(sig);
    aliased[0] = sig[0]! + 8;
    expect(recoverCompact(h, aliased)?.keyId).toEqual(owner);
    expect(verifyCompactCanonical(h, owner, aliased)).toMatchObject({ ok: false, reason: "header" });

    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt("0x" + bytesToHex(sig.subarray(33)));
    const highS = Uint8Array.from(sig);
    highS.set(hexToBytes((N - s).toString(16).padStart(64, "0")), 33);
    const hdr = sig[0]! - 27;
    highS[0] = 27 + (hdr & 4) + ((hdr & 3) ^ 1);
    expect(recoverCompact(h, highS)?.keyId).toEqual(owner);
    expect(verifyCompactCanonical(h, owner, highS)).toMatchObject({ ok: false, reason: "high-s" });
    expect(verifyCompactCanonical(h, d.payload.shares[0]!.keyIDOwner, sig)).toMatchObject({
      ok: false,
      reason: "key-mismatch",
    });
  });
});
