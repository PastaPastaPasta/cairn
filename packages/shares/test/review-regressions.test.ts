/** Regressions for review findings: label-only row binding, relative time locks, Core-parity nits. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { COIN } from "../src/amounts.ts";
import { type CheckResult, checkEnvelopeAgainstTerms, checkRegistrationAgainstTerms } from "../src/check.ts";
import { sharedRegConsentHash } from "../src/consent.ts";
import { envelopeFingerprint, parseSessionEnvelope } from "../src/envelope.ts";
import { decodeSharedProRegTx, encodeProRegTxPayload } from "../src/proregtx.ts";
import { suggestCombos } from "../src/rules.ts";
import { type TermSheet, TermSheetError, canonicalize, parseTermSheet } from "../src/terms.ts";
import { encodeTxHex } from "../src/tx.ts";
import { readUniValue } from "../src/univalue.ts";

// biome-ignore lint: fixture JSON
type J = any;
const load = (name: string): J => JSON.parse(readFileSync(new URL(`./vectors/regtest/${name}`, import.meta.url), "utf8"));
const ENVS: Array<{ name: string; text: string }> = load("envelopes.json");
const A: J = load("mn-a.json");
const env = (name: string) => ENVS.find((e) => e.name === name)!.text;
const codes = (r: CheckResult, level: string) => r.findings.filter((f) => f.level === level).map((f) => f.code);
const restamp = (text: string) =>
  text.replace(/"fingerprint": "[0-9A-F-]+"/, `"fingerprint": "${envelopeFingerprint(readUniValue(text)!)}"`);

const terms: TermSheet = {
  network: "regtest",
  groupId: "group-1",
  revision: 2,
  shares: [
    { memberId: "id-alice", label: "Alice", amount: 500n * COIN },
    { memberId: "id-bob", label: "Bob", amount: 300n * COIN },
    { memberId: "id-carol", label: "Carol", amount: 200n * COIN },
  ],
  operatorPubKey: A.operator.public,
  service: "127.0.0.1:20001",
  votingAddress: A.operator.votingAddress,
  votingHolderId: "id-alice",
  rewardBps: 500,
  earlyPeriodBlocks: 30,
  earlyPenalty: 50n * COIN,
  coordinatorId: "id-alice",
};
const [alice, bob] = A.prepareArgs.shares;

describe("rows are bound to people by owner address, not by label", () => {
  // The coordinator swaps Alice's and Bob's addresses between the 500 and 300 rows
  const swapped = restamp(
    env("draft-complete")
      .replaceAll(alice.ownerAddress, "@A_OWNER@")
      .replaceAll(alice.refundAddress, "@A_REFUND@")
      .replaceAll(alice.rewardAddress, "@A_REWARD@")
      .replaceAll(bob.ownerAddress, alice.ownerAddress)
      .replaceAll(bob.refundAddress, alice.refundAddress)
      .replace(`"rewardAddress": "@A_REWARD@"`, `"rewardAddress": ""`)
      .replace(/("refundAddress": "@A_REFUND@",\n\s+"rewardAddress": )""/, `$1"${alice.rewardAddress}"`)
      .replaceAll("@A_OWNER@", bob.ownerAddress)
      .replaceAll("@A_REFUND@", bob.refundAddress),
  );

  test("the swap is really in the message", () => {
    const r = parseSessionEnvelope(swapped);
    expect(r.envelope!.shares[0]!.ownerAddress).toBe(bob.ownerAddress);
    expect(r.envelope!.shares[1]!.ownerAddress).toBe(alice.ownerAddress);
  });

  test("by label alone, my amount is only info, never verified", () => {
    const r = checkEnvelopeAgainstTerms(swapped, terms, { myLabel: "Alice" });
    expect(r.findings.find((f) => f.code === "my-row")!.level).toBe("info");
  });

  test("with my owner address the swap is a stop", () => {
    const r = checkEnvelopeAgainstTerms(swapped, terms, { myLabel: "Alice", myOwnerAddress: alice.ownerAddress });
    expect(r.verdict).toBe("stop");
    expect(codes(r, "stop")).toContain("my-row-moved");
    const honest = checkEnvelopeAgainstTerms(env("draft-complete"), terms, { myLabel: "Alice", myOwnerAddress: alice.ownerAddress });
    expect(honest.verdict).toBe("ok");
    expect(honest.findings.find((f) => f.code === "my-row")!.level).toBe("ok");
    const foreign = checkEnvelopeAgainstTerms(env("draft-complete"), terms, { myLabel: "Alice", myOwnerAddress: A.updateRegistrar.args.votingAddress });
    expect(codes(foreign, "stop")).toContain("my-owner-changed");
  });

  test("with recorded row addresses the swap is a stop for everyone", () => {
    const rowAddresses = {
      Alice: { ownerAddress: alice.ownerAddress, refundAddress: alice.refundAddress, rewardAddress: alice.rewardAddress },
      Bob: { ownerAddress: bob.ownerAddress, refundAddress: bob.refundAddress, rewardAddress: "" },
    };
    expect(codes(checkEnvelopeAgainstTerms(swapped, terms, { rowAddresses }), "stop")).toContain("row-moved");
    expect(checkEnvelopeAgainstTerms(env("draft-complete"), terms, { rowAddresses }).verdict).toBe("ok");
    const refundChanged = restamp(env("draft-complete").replace(`"refundAddress": "${bob.refundAddress}"`, `"refundAddress": "${A.prepareArgs.shares[2].refundAddress}"`));
    expect(codes(checkEnvelopeAgainstTerms(refundChanged, terms, { rowAddresses }), "stop")).toContain("row-address-changed");
  });

  test("registration: owners bind amounts to people", () => {
    const owners = [
      { ownerAddress: alice.ownerAddress, amount: 500n * COIN, label: "Alice" },
      { ownerAddress: bob.ownerAddress, amount: 300n * COIN, label: "Bob" },
    ];
    expect(checkRegistrationAgainstTerms(A.final, terms, { owners }).verdict).toBe("ok");
    const wrong = [{ ownerAddress: alice.ownerAddress, amount: 300n * COIN, label: "Alice" }];
    expect(codes(checkRegistrationAgainstTerms(A.final, terms, { owners: wrong }), "stop")).toEqual(["owner-amount"]);
    const absent = [{ ownerAddress: A.operator.votingAddress, amount: 300n * COIN }];
    expect(codes(checkRegistrationAgainstTerms(A.final, terms, { owners: absent }), "stop")).toEqual(["owner-missing"]);
  });
});

test("a BIP68 relative lock on funding inputs is a stop (Core's shared_sign refuses it)", () => {
  const d = decodeSharedProRegTx(A.prepared.tx);
  for (const i of d.tx.vin) i.sequence = 0x0000ffff;
  const hex = encodeTxHex(d.tx);
  const consent = sharedRegConsentHash(d.tx, d.payload).hex;
  const text = restamp(
    env("frozen").replace(A.prepared.tx, hex).replace(A.prepared.consentHash, consent).replaceAll('"sequence": 4294967295', '"sequence": 65535'),
  );
  expect(parseSessionEnvelope(text).ok).toBe(true); // Dash-Qt's parser accepts it...
  const r = checkEnvelopeAgainstTerms(text, terms);
  expect(r.verdict).toBe("stop"); // ...but nobody should sign it
  expect(codes(r, "stop")).toEqual(["time-lock"]);
  // the wallet's fee-sniping sequence 0xfffffffe is not a lock
  const sniping = restamp(env("draft-complete").replaceAll('"sequence": 4294967295', '"sequence": 4294967294'));
  expect(codes(checkEnvelopeAgainstTerms(sniping, terms), "stop")).toEqual([]);
});

test("registration hex with fields consensus rejects is a stop", () => {
  const d = decodeSharedProRegTx(A.final);
  d.payload.vchSig = Uint8Array.of(1);
  const hex = encodeTxHex({ ...d.tx, extraPayload: encodeProRegTxPayload(d.payload) });
  expect(codes(checkRegistrationAgainstTerms(hex, terms), "stop")).toEqual(["invalid-protx"]);
});

test("an invalid term sheet is itself a stop", () => {
  const r = checkEnvelopeAgainstTerms(env("draft-complete"), { ...terms, rewardBps: 20000 });
  expect(codes(r, "stop")).toEqual(expect.arrayContaining(["terms-invalid"]));
});

describe("Core-parity nits", () => {
  test("a leading BOM is not whitespace for Qt, so Dash-Qt refuses the message", () => {
    expect(parseSessionEnvelope("﻿" + env("signing")).errorCode).toBe("not-json");
    expect(parseSessionEnvelope("  " + env("signing")).ok).toBe(true);
  });

  test("fingerprint comparison is ASCII case-insensitive only", () => {
    const text = env("draft-complete");
    const code = text.match(/"fingerprint": "([0-9A-F-]+)"/)![1]!;
    expect(parseSessionEnvelope(text.replace(code, code.toLowerCase())).fingerprint!.status).toBe("ok");
    if (code.includes("FF")) {
      expect(parseSessionEnvelope(text.replace(code, code.replace("FF", "ﬀ"))).fingerprint!.status).toBe("mismatch");
    }
    expect(parseSessionEnvelope(text.replace(code, "ﬀﬀ-0000")).fingerprint!.status).toBe("mismatch");
  });

  test("suggestCombos never offers a single share for an empty roster", () => {
    expect(suggestCombos(1000n * COIN, [1000n * COIN, 600n * COIN, 400n * COIN], 8)).toEqual([[1, 2]]);
  });

  test("parseTermSheet reports malformed share entries as TermSheetError", () => {
    const o = JSON.parse(canonicalize(terms));
    o.shares[1] = null;
    expect(() => parseTermSheet(o)).toThrow(TermSheetError);
  });
});
