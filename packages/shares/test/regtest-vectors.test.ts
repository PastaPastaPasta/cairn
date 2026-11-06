/**
 * End-to-end vectors from a real Dash Core 24.0.0 regtest node (see vectors/regtest/generate.sh):
 * every value our code computes is compared with what Core's RPCs returned.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { addressToKeyId, addressToScript, decodeAddress, keyIdToAddress, scriptToAddress } from "../src/address.ts";
import { bytesToHex } from "../src/bytes.ts";
import {
  decodeBase64Core,
  proDisSignHash,
  proUpShareSignHash,
  proUpSharedRegSignHash,
  recoverCompact,
  sharedRegConsentHash,
  verifyCompactCanonical,
  verifyJoinSigs,
} from "../src/consent.ts";
import { type ChainShare, inspectProDisTx, readDissolution } from "../src/envelope.ts";
import { coreP2PEntries, isNetInfoEmpty, netInfoMatchesServiceList } from "../src/netinfo.ts";
import {
  decodeProUpShareTxPayload,
  decodeProUpSharedRegTxPayload,
  decodeSharedProRegTx,
  encodeProRegTxPayload,
  identifySpecialTx,
} from "../src/proregtx.ts";
import { earlyPeriodEndHeight, isEarlyAt, penaltyBonuses, splitMasternodePayment, splitOwnerReward } from "../src/rewards.ts";
import { isShareListTriviallyValid } from "../src/rules.ts";
import { calcTxInputsHash, decodeTx, encodeTxHex, txid } from "../src/tx.ts";
import { uint256ToHex } from "../src/bytes.ts";

// biome-ignore lint: fixture JSON
type J = any;
const load = (name: string): J => JSON.parse(readFileSync(new URL(`./vectors/regtest/${name}`, import.meta.url), "utf8"));
const A: J = load("mn-a.json");
const B: J = load("mn-b.json");
const CHAIN: J = load("chain.json");

function chainShares(info: J): ChainShare[] {
  return info.state.shares.map((s: J) => ({
    amount: BigInt(s.amount),
    scriptRefund: Uint8Array.from(Buffer.from(s.refundScript, "hex")),
    keyIDOwner: addressToKeyId(s.ownerAddress, "regtest")!,
  }));
}

test("fixtures come from dashd 24.0.0 with v24 active", () => {
  expect(CHAIN.version).toBe("/Dash Core:24.0.0/");
  expect(CHAIN.v24.active).toBe(true);
});

for (const [name, M] of [
  ["A (500/300/200, service, 5%, 30 blocks, 50 DASH)", A],
  ["B (400/300/200/100, P2SH refund/reward, no service, no early period)", B],
] as const) {
  describe(`masternode ${name}`, () => {
    const prepared = decodeSharedProRegTx(M.prepared.tx);
    const final = decodeSharedProRegTx(M.final);
    const terms = M.prepared.terms;

    test("prepare: consent hash equals Core's consentHash", () => {
      expect(sharedRegConsentHash(prepared.tx, prepared.payload).hex).toBe(M.prepared.consentHash);
      expect(prepared.collateralIndex).toBe(M.prepared.collateralIndex);
    });

    test("prepare appended the template output to the funding tx and filled inputsHash", () => {
      const funding = decodeTx(M.fundingTx);
      expect(prepared.tx.vin.map((i) => i.prevout)).toEqual(funding.vin.map((i) => i.prevout));
      expect(prepared.tx.vout.slice(0, -1)).toEqual(funding.vout);
      expect(bytesToHex(prepared.tx.vout.at(-1)!.script)).toBe("04445348437551");
      expect(prepared.tx.vout.at(-1)!.value).toBe(100000000000n);
      expect(uint256ToHex(prepared.payload.inputsHash)).toBe(uint256ToHex(calcTxInputsHash(prepared.tx)));
      expect(uint256ToHex(final.payload.inputsHash)).toBe(M.finalDecoded.proRegTx.inputsHash);
    });

    test("decoded payload equals Core's decoderawtransaction / shared_sign terms", () => {
      const p = final.payload;
      const core = M.finalDecoded.proRegTx;
      expect(p.version).toBe(core.version);
      expect(p.mnType).toBe(core.type);
      expect(p.collateralOutpoint.vout).toBe(core.collateralIndex);
      expect(coreP2PEntries(p.netInfo)).toEqual(core.addresses.core_p2p ?? []);
      expect(keyIdToAddress(p.keyIDVoting, "regtest")).toBe(core.votingAddress);
      expect(bytesToHex(p.pubKeyOperator)).toBe(core.pubKeyOperator);
      expect(p.operatorReward / 100).toBe(core.operatorReward);
      expect(p.earlyPeriodBlocks).toBe(core.earlyPeriodBlocks);
      expect(p.earlyPenalty).toBe(BigInt(core.earlyPenalty));
      expect(p.shares).toHaveLength(terms.shares.length);
      p.shares.forEach((s, i) => {
        const c = terms.shares[i];
        expect(s.amount).toBe(BigInt(c.amount));
        expect(bytesToHex(s.scriptRefund)).toBe(c.refundScript);
        expect(scriptToAddress(s.scriptRefund, "regtest")).toBe(c.refundAddress);
        expect(bytesToHex(s.scriptReward.length ? s.scriptReward : s.scriptRefund)).toBe(c.rewardScript);
        expect(keyIdToAddress(s.keyIDOwner, "regtest")).toBe(c.ownerAddress);
        // and the RPC inputs
        const arg = M.prepareArgs.shares[i];
        expect(bytesToHex(s.scriptRefund)).toBe(bytesToHex(addressToScript(arg.refundAddress, "regtest")!));
        expect(s.scriptReward.length > 0).toBe(arg.rewardAddress !== undefined);
      });
      expect(netInfoMatchesServiceList(p.netInfo, M.prepareArgs.coreP2PAddrs)).toBe(true);
      expect(isShareListTriviallyValid(p.shares, p.earlyPeriodBlocks, p.earlyPenalty, p.keyIDVoting).ok).toBe(true);
    });

    test("every shared_sign signature recovers its share's owner key over the consent hash", () => {
      const h = sharedRegConsentHash(prepared.tx, prepared.payload);
      for (const s of M.signatures) {
        const sig = decodeBase64Core(s.signature)!;
        expect(sig).toHaveLength(65);
        const owner = addressToKeyId(terms.shares[s.shareIndex].ownerAddress, "regtest")!;
        expect(verifyCompactCanonical(h.bytes, owner, sig).ok).toBe(true);
        expect(recoverCompact(h.bytes, sig)!.compressed).toBe(true);
      }
    });

    test("shared_combine embeds exactly those signatures; the final tx's joinSigs verify", () => {
      const combined = decodeSharedProRegTx(M.combined);
      expect(combined.payload.joinSigs.map((s) => Buffer.from(s).toString("base64"))).toEqual(
        M.signatures.map((s: J) => s.signature),
      );
      const { consentHash, results } = verifyJoinSigs(final.tx, final.payload);
      expect(consentHash.hex).toBe(M.prepared.consentHash);
      expect(results.every((r) => r.ok)).toBe(true);
    });

    test("funding signatures only add scriptSigs; txid of the final tx is the proTxHash", () => {
      const steps = M.fundingSigned.map((s: J) => decodeTx(s.hex));
      for (const t of steps) expect(sharedRegConsentHash(t, final.payload).hex).toBe(M.prepared.consentHash);
      expect(steps.at(-1).vin.every((i: J) => i.scriptSig.length > 0)).toBe(true);
      expect(decodeTx(M.combined).vin.every((i) => i.scriptSig.length === 0)).toBe(true);
      expect(final.txid).toBe(M.proTxHash);
      expect(txid(decodeTx(M.final))).toBe(M.finalDecoded.txid);
      expect(encodeTxHex(final.tx)).toBe(M.final);
      expect(bytesToHex(encodeProRegTxPayload(final.payload))).toBe(M.finalDecoded.extraPayload);
    });

    test("protx info reports the share table we decoded", () => {
      const info = M.protxInfo;
      expect(info.proTxHash).toBe(final.txid);
      expect(info.collateralHash).toBe(final.txid);
      expect(info.collateralIndex).toBe(final.collateralIndex);
      final.payload.shares.forEach((s, i) => {
        expect(info.state.shares[i].ownerAddress).toBe(keyIdToAddress(s.keyIDOwner, "regtest"));
        expect(BigInt(info.state.shares[i].amount)).toBe(s.amount);
      });
      expect(isNetInfoEmpty(final.payload.netInfo)).toBe(Object.keys(info.state.addresses).length === 0);
    });

    test("the unanimous dissolution: sign hash equals Core's, every share signs, principal returned", () => {
      const u = M.unanimousDissolve;
      const rep = inspectProDisTx(u.combined, chainShares(M.protxInfo));
      expect(rep.proTxHash).toBe(M.proTxHash);
      expect(rep.mode).toBe("unanimous");
      expect(proDisSignHash(decodeTx(u.prepared.tx), rep.payload, final.payload.shares.length).hex).toBe(u.prepared.signHash);
      expect(rep.sigs!.every((s) => s.valid)).toBe(true);
      expect(rep.reading!.returnsPrincipal).toBe(true);
      expect(rep.reading!.fee).toBe(100000n);
      expect(rep.payload.sigs.map((s) => Buffer.from(s).toString("base64"))).toEqual(u.signatures.map((s: J) => s.signature));
      if (u.txid) expect(rep.txid).toBe(u.txid);
    });
  });
}

describe("masternode A lifecycle", () => {
  const final = decodeSharedProRegTx(A.final);
  const shares = chainShares(A.protxInfo);

  test("owner rewards: coinbase pays exactly splitOwnerReward of the masternode reward", () => {
    for (const p of A.payouts) {
      const owner = p.masternode.filter((m: J) => m.script !== "6a");
      const total = owner.reduce((a: bigint, m: J) => a + BigInt(m.amount), 0n);
      // no operator payout address was set, so the 5% operator cut stays with the owners
      const split = splitMasternodePayment(total, final.payload.operatorReward, final.payload.shares, false);
      expect(split.operator).toBe(0n);
      expect(split.owners).toEqual(owner.map((m: J) => BigInt(m.amount)));
      expect(owner.map((m: J) => m.script)).toEqual(
        A.protxInfo.state.shares.map((s: J) => s.rewardScript),
      );
      const cb = p.coinbaseVout.filter((o: J) => owner.some((m: J) => m.script === o.script)).map((o: J) => BigInt(o.valueSat));
      expect(cb).toEqual(split.owners);
      expect(splitOwnerReward(total, [500n, 300n, 200n])).toEqual(split.owners);
    }
  });

  test("ProUpShareTx: decodes, signed by share 1's owner over SerializeHash(payload)", () => {
    const u = A.updateShare;
    const info = identifySpecialTx(u.hex);
    expect(info.kind).toBe("proUpShareTx");
    expect(info.txid).toBe(u.txid);
    const p = decodeProUpShareTxPayload(decodeTx(u.hex).extraPayload);
    expect(p.proTxHash).toBe(A.proTxHash);
    expect(p.shareIndex).toBe(1);
    expect(scriptToAddress(p.scriptReward, "regtest")).toBe(u.args.rewardAddress);
    expect(uint256ToHex(p.inputsHash)).toBe(u.decoded.proUpShareTx.inputsHash);
    expect(verifyCompactCanonical(proUpShareSignHash(p).bytes, shares[1]!.keyIDOwner, p.vchSig).ok).toBe(true);
    expect(u.protxInfo.state.shares[1].rewardAddress).toBe(u.args.rewardAddress);
  });

  test("ProUpSharedRegTx: sign hash equals Core's signHash; all three owners signed", () => {
    const r = A.updateRegistrar;
    const info = identifySpecialTx(r.combined);
    expect(info.kind).toBe("proUpSharedRegTx");
    expect(info.txid).toBe(r.txid);
    const unsigned = decodeProUpSharedRegTxPayload(decodeTx(r.prepared.tx).extraPayload);
    const p = decodeProUpSharedRegTxPayload(decodeTx(r.combined).extraPayload);
    expect(proUpSharedRegSignHash(unsigned).hex).toBe(r.prepared.signHash);
    expect(proUpSharedRegSignHash(p).hex).toBe(r.prepared.signHash);
    expect(keyIdToAddress(p.keyIDVoting, "regtest")).toBe(r.args.votingAddress);
    expect(bytesToHex(p.pubKeyOperator)).toBe(A.operator.public);
    p.sigs.forEach((sig, i) => expect(verifyCompactCanonical(proUpSharedRegSignHash(p).bytes, shares[i]!.keyIDOwner, sig).ok).toBe(true));
    expect(r.protxInfo.state.votingAddress).toBe(r.args.votingAddress);
  });

  test("standby dissolutions: unilateral by share 2; the immediate one pays the pro-rata penalty", () => {
    const s = A.standby;
    const full = inspectProDisTx(s.full, shares);
    const now = inspectProDisTx(s.immediate, shares);
    for (const rep of [full, now]) {
      expect(rep.mode).toBe("unilateral");
      expect(rep.actorIndex).toBe(2);
      expect(rep.sigs!.map((x) => x.valid)).toEqual([true]);
      expect(proDisSignHash(rep.tx, rep.payload, 1).hex).not.toBe(proDisSignHash(rep.tx, rep.payload, 3).hex);
    }
    expect(full.reading!.returnsPrincipal).toBe(true);
    expect(full.reading!.fee).toBe(100000n);
    expect(now.reading!.returnsPrincipal).toBe(false);
    expect(now.reading!.layoutOk).toBe(true);
    const bonuses = penaltyBonuses(5000000000n, [500n, 300n, 200n].map((x) => x * 100000000n), 2);
    expect(now.reading!.bonuses).toEqual(bonuses);
    expect(bonuses[0]! + bonuses[1]!).toBe(5000000000n);
    expect(now.tx.vout.map((o) => o.value)).toEqual(s.immediateDecoded.vout.map((o: J) => BigInt(o.valueSat)));
  });

  test("early period: the full-principal standby is rejected while early; the penalty one confirms", () => {
    const reg = A.registeredBlock.height;
    expect(isEarlyAt(A.standby.tipHeight + 1, reg, 30)).toBe(true);
    expect(earlyPeriodEndHeight(reg, 30)).toBe(A.protxInfo.state.registeredHeight + 30);
    expect(A.standbyFullEarlyReject).toContain("bad-prodis-penalty-floor");
    expect(txid(decodeTx(A.dissolved.hex))).toBe(A.dissolved.txid);
    expect(A.dissolved.protxInfoError).toContain("not found");
  });

  test("readDissolution refuses a request that pays someone else", () => {
    const tx = decodeTx(A.unanimousDissolve.prepared.tx);
    const tampered = structuredClone(tx);
    tampered.vout[0]!.script = addressToScript(A.prepareArgs.shares[0].refundAddress, "regtest")!;
    expect(readDissolution(tampered, 0, shares).returnsPrincipal).toBe(false);
    const greedy = structuredClone(tx);
    greedy.vout[2]!.value -= 2_000_000n;
    expect(readDissolution(greedy, 0, shares).returnsPrincipal).toBe(false);
  });
});

describe("masternode B specifics", () => {
  test("P2SH refund and reward scripts, two shares in one wallet, empty service", () => {
    const p = decodeSharedProRegTx(B.final).payload;
    expect(decodeAddress(B.prepareArgs.shares[2].refundAddress, "regtest")!.type).toBe("p2sh");
    expect(bytesToHex(p.shares[2]!.scriptRefund)).toMatch(/^a914[0-9a-f]{40}87$/);
    expect(bytesToHex(p.shares[1]!.scriptReward)).toMatch(/^a914[0-9a-f]{40}87$/);
    expect(isNetInfoEmpty(p.netInfo)).toBe(true);
    expect(B.prepared.warning).toMatch(/earlyPenalty is zero/);
    expect(B.sharedSign.w1.signatures.map((s: J) => s.shareIndex)).toEqual([0, 3]);
    expect(B.protxInfo.state.PoSeBanHeight).toBe(B.protxInfo.state.registeredHeight);
    expect(B.unanimousDissolve.protxInfoError).toContain("not found");
  });
});
