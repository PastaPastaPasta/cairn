import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { keyIdToAddress } from "../src/address.ts";
import { COIN } from "../src/amounts.ts";
import { bytesToHex } from "../src/bytes.ts";
import { type CheckResult, checkEnvelopeAgainstTerms, checkRegistrationAgainstTerms } from "../src/check.ts";
import { envelopeFingerprint } from "../src/envelope.ts";
import { decodeSharedProRegTx, encodeProRegTxPayload } from "../src/proregtx.ts";
import { type TermSheet, canonicalize, parseTermSheet, termsHash, validateTermSheet } from "../src/terms.ts";
import { encodeTxHex } from "../src/tx.ts";
import { readUniValue } from "../src/univalue.ts";

// biome-ignore lint: fixture JSON
type J = any;
const load = (name: string): J => JSON.parse(readFileSync(new URL(`./vectors/regtest/${name}`, import.meta.url), "utf8"));
const ENVS: Array<{ name: string; text: string }> = load("envelopes.json");
const A: J = load("mn-a.json");
const env = (name: string) => ENVS.find((e) => e.name === name)!.text;
const TESTNET_HEX = readFileSync(new URL("./vectors/testnet-d400c120.hex", import.meta.url), "utf8").trim();

const termsA: TermSheet = {
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

const codes = (r: CheckResult, level?: string) => r.findings.filter((f) => !level || f.level === level).map((f) => f.code);

describe("term sheet", () => {
  test("canonical JSON: sorted keys, no whitespace, bigints as strings", () => {
    const t: TermSheet = { ...termsA, shares: termsA.shares.slice(0, 2), operatorPubKey: "ab".repeat(48), votingAddress: "yV" };
    expect(canonicalize(t)).toBe(
      '{"coordinatorId":"id-alice","earlyPenalty":"5000000000","earlyPeriodBlocks":30,"groupId":"group-1",' +
        '"network":"regtest","operatorPubKey":"' +
        "ab".repeat(48) +
        '","revision":2,"rewardBps":500,"service":"127.0.0.1:20001",' +
        '"shares":[{"amount":"50000000000","label":"Alice","memberId":"id-alice"},{"amount":"30000000000","label":"Bob","memberId":"id-bob"}],' +
        '"votingAddress":"yV","votingHolderId":"id-alice"}',
    );
  });

  test("termsHash = sha256(domain + canonical), independent of property order and extra fields", () => {
    const expected = createHash("sha256").update("cairn-terms-v1\n" + canonicalize(termsA), "utf8").digest("hex");
    expect(termsHash(termsA)).toBe(expected);
    const shuffled = Object.fromEntries(Object.entries(termsA).reverse()) as unknown as TermSheet;
    expect(termsHash(shuffled)).toBe(expected);
    expect(termsHash({ ...termsA, extra: 1 } as TermSheet)).toBe(expected);
    expect(termsHash({ ...termsA, revision: 3 })).not.toBe(expected);
    expect(termsHash({ ...termsA, shares: [...termsA.shares].reverse() })).not.toBe(expected);
    const unicode = { ...termsA, shares: termsA.shares.map((s, i) => (i ? s : { ...s, label: "Zoë ✓" })) };
    expect(termsHash(unicode)).toBe(createHash("sha256").update("cairn-terms-v1\n" + canonicalize(unicode), "utf8").digest("hex"));
  });

  test("parseTermSheet round trips the canonical form", () => {
    expect(parseTermSheet(canonicalize(termsA))).toEqual(termsA);
    expect(() => parseTermSheet({ ...JSON.parse(canonicalize(termsA)), earlyPenalty: 5 })).toThrow();
  });

  test("validation", () => {
    expect(validateTermSheet(termsA)).toEqual([]);
    const v = (patch: Partial<TermSheet>) => validateTermSheet({ ...termsA, ...patch }).map((i) => i.code);
    expect(v({ shares: termsA.shares.slice(0, 1) })).toContain("bad-protx-shares-count");
    expect(v({ shares: [{ ...termsA.shares[0]!, amount: 600n * COIN }, ...termsA.shares.slice(1)] })).toContain("bad-protx-shares-amount-sum");
    expect(v({ shares: [...termsA.shares.slice(0, 2), { ...termsA.shares[2]!, label: "Bob" }] })).toContain("duplicate-label");
    expect(v({ shares: [...termsA.shares.slice(0, 2), { ...termsA.shares[2]!, memberId: "id-bob" }] })).toContain("duplicate-member");
    expect(v({ operatorPubKey: "AB".repeat(48) })).toContain("operator-key");
    expect(v({ service: "1.2.3.4" })).toContain("service");
    expect(v({ service: "" })).toEqual([]);
    expect(v({ network: "main", votingAddress: keyIdToAddress(new Uint8Array(20).fill(1), "main"), service: "1.2.3.4:19999" })).toEqual(["service-mainnet"]);
    expect(v({ votingAddress: keyIdToAddress(new Uint8Array(20).fill(1), "main") })).toContain("voting-address");
    expect(v({ rewardBps: 10001 })).toContain("bad-protx-operator-reward");
    expect(v({ earlyPeriodBlocks: 420481 })).toContain("bad-protx-shares-early-period");
    expect(v({ earlyPenalty: 200n * COIN })).toContain("bad-protx-shares-penalty");
    expect(v({ earlyPeriodBlocks: 0 })).toContain("bad-protx-shares-penalty");
    expect(v({ earlyPeriodBlocks: 0, earlyPenalty: 0n })).toEqual([]);
    expect(v({ earlyPenalty: 0n })).toEqual(["penalty-required"]);
    expect(v({ revision: 0 })).toContain("revision");
  });
});

describe("checkEnvelopeAgainstTerms", () => {
  test("every stage of the real session matches the agreed terms", () => {
    for (const name of ["draft-invitation", "draft-complete", "frozen", "signing", "combined", "fundingSigned", "broadcast"]) {
      const r = checkEnvelopeAgainstTerms(env(name), termsA, { myLabel: "Bob" });
      expect(r.verdict, `${name}: ${JSON.stringify(r.findings.filter((f) => f.level !== "ok" && f.level !== "info"))}`).toBe("ok");
      expect(codes(r)).toContain("my-row");
    }
    const c = checkEnvelopeAgainstTerms(env("combined"), termsA);
    expect(c.stage).toBe("combined");
    expect(codes(c, "ok")).toEqual(expect.arrayContaining(["fingerprint", "shares", "consent-hash", "payload-matches"]));
    expect(c.findings.find((f) => f.code === "approvals")!.title).toBe("3 of 3 approvals");
    const s = checkEnvelopeAgainstTerms(env("signing"), termsA);
    expect(s.findings.find((f) => f.code === "approvals")!.title).toBe("1 of 3 approvals");
    expect(checkEnvelopeAgainstTerms(env("draft-invitation"), termsA).findings.find((f) => f.code === "rows-unfilled")!.title).toMatch(/Bob, Carol/);
  });

  test("any difference from the agreed terms is a stop", () => {
    const stop = (t: Partial<TermSheet>, code: string, stage = "frozen") => {
      const r = checkEnvelopeAgainstTerms(env(stage), { ...termsA, ...t });
      expect(r.verdict).toBe("stop");
      expect(codes(r, "stop")).toContain(code);
    };
    stop({ shares: [termsA.shares[0]!, { ...termsA.shares[1]!, amount: 250n * COIN }, { ...termsA.shares[2]!, amount: 250n * COIN }] }, "share-amount");
    stop({ shares: [termsA.shares[0]!, { ...termsA.shares[1]!, label: "Robert" }, termsA.shares[2]!] }, "share-missing");
    stop({ operatorPubKey: "11".repeat(48) }, "operator-key");
    stop({ operatorPubKey: "11".repeat(48) }, "tx-operator-key");
    stop({ service: "127.0.0.1:20002" }, "service");
    stop({ service: "" }, "tx-service");
    stop({ votingAddress: A.updateRegistrar.args.votingAddress }, "voting-address");
    stop({ votingAddress: A.updateRegistrar.args.votingAddress }, "tx-voting");
    stop({ rewardBps: 400 }, "operator-reward");
    stop({ earlyPeriodBlocks: 31 }, "early-terms");
    stop({ earlyPenalty: 49n * COIN }, "tx-early");
    stop({ network: "test" }, "network", "draft-complete");
  });

  test("an extra or missing row is a stop; a different order is only info", () => {
    const fourth = { ...termsA, shares: [...termsA.shares.slice(0, 2), { memberId: "d", label: "Dave", amount: 100n * COIN }, { ...termsA.shares[2]!, amount: 100n * COIN }] };
    expect(codes(checkEnvelopeAgainstTerms(env("draft-complete"), fourth), "stop")).toEqual(expect.arrayContaining(["share-missing", "share-amount"]));
    const reordered = { ...termsA, shares: [termsA.shares[2]!, termsA.shares[0]!, termsA.shares[1]!] };
    const r = checkEnvelopeAgainstTerms(env("combined"), reordered);
    expect(r.verdict).toBe("ok");
    expect(codes(r, "info")).toContain("share-order");
  });

  test("my row", () => {
    expect(codes(checkEnvelopeAgainstTerms(env("frozen"), termsA, { myLabel: "Dave" }), "stop")).toContain("my-terms-missing");
    const swapped = { ...termsA, shares: [{ ...termsA.shares[0]!, label: "Carol" }, termsA.shares[1]!, { ...termsA.shares[2]!, label: "Alice" }] };
    const r = checkEnvelopeAgainstTerms(env("draft-complete"), swapped, { myLabel: "Carol" });
    expect(codes(r, "stop")).toEqual(expect.arrayContaining(["share-amount", "my-amount"]));
    const funded = checkEnvelopeAgainstTerms(env("fundingSigned"), termsA, { myLabel: "Bob" });
    expect(funded.findings.find((f) => f.code === "my-contribution")!.detail).toContain(`50 DASH to ${A.contributions[1].change.address}`);
    const signing = checkEnvelopeAgainstTerms(env("signing"), termsA, { myLabel: "Alice" });
    expect(signing.findings.find((f) => f.code === "my-approval")!.title).toBe("Your approval is included");
  });

  test("tampering: edited message warns; re-stamped edit of a frozen session stops", () => {
    const edited = env("draft-complete").replace('"revision": 9', '"revision": 10');
    const w = checkEnvelopeAgainstTerms(edited, termsA);
    expect(w.verdict).toBe("warn");
    expect(codes(w, "warn")).toEqual(["fingerprint-mismatch"]);
    const changed = env("frozen").replace('"amount": 20000000000', '"amount": 20000000001');
    const restamped = changed.replace(/"fingerprint": "[0-9A-F-]+"/, `"fingerprint": "${envelopeFingerprint(readUniValue(changed)!)}"`);
    const s = checkEnvelopeAgainstTerms(restamped, termsA);
    expect(s.verdict).toBe("stop");
    expect(codes(s, "stop")).toEqual(expect.arrayContaining(["core-payload-mismatch", "share-amount", "payload-mismatch"]));
    expect(checkEnvelopeAgainstTerms("hello", termsA)).toMatchObject({ verdict: "stop", stage: "unknown" });
  });

  test("zero early period: anyone can leave at any time", () => {
    const t = { ...termsA, earlyPeriodBlocks: 0, earlyPenalty: 0n };
    const text = env("draft-complete").replace('"earlyPeriodBlocks": 30', '"earlyPeriodBlocks": 0').replace('"earlyPenalty": 5000000000', '"earlyPenalty": 0');
    const r = checkEnvelopeAgainstTerms(text, t);
    expect(codes(r, "warn")).toEqual(["fingerprint-mismatch", "no-early-period"]);
    expect(r.findings.find((f) => f.code === "no-early-period")!.title).toBe("Anyone can leave at any time");
  });
});

describe("checkRegistrationAgainstTerms", () => {
  test("the regtest registration matches, in any share order", () => {
    const r = checkRegistrationAgainstTerms(A.final, termsA);
    expect(r.verdict).toBe("ok");
    expect(codes(r, "ok")).toEqual(expect.arrayContaining(["shares", "join-sigs"]));
    const reordered = checkRegistrationAgainstTerms(A.final, { ...termsA, shares: [...termsA.shares].reverse() });
    expect(reordered.verdict).toBe("ok");
    expect(codes(reordered, "info")).toContain("share-order");
  });

  test("differences and broken signatures stop", () => {
    expect(codes(checkRegistrationAgainstTerms(A.final, { ...termsA, rewardBps: 0 }), "stop")).toEqual(["tx-reward"]);
    expect(codes(checkRegistrationAgainstTerms(A.final, { ...termsA, service: "127.0.0.1:1" }), "stop")).toEqual(["tx-service"]);
    expect(codes(checkRegistrationAgainstTerms(A.updateShare.hex, termsA), "stop")).toEqual(["not-shared-protx"]);
    expect(checkRegistrationAgainstTerms(A.final, termsA, { proTxHash: A.proTxHash.toUpperCase() }).verdict).toBe("ok");
    expect(codes(checkRegistrationAgainstTerms(A.final, termsA, { proTxHash: "00".repeat(32) }), "stop")).toEqual(["protx-hash"]);
    const d = decodeSharedProRegTx(A.final);
    d.payload.joinSigs[1] = d.payload.joinSigs[0]!;
    const forged = encodeTxHex({ ...d.tx, extraPayload: encodeProRegTxPayload(d.payload) });
    expect(codes(checkRegistrationAgainstTerms(forged, termsA), "stop")).toEqual(["join-sigs"]);
  });

  test("the real testnet registration d400c120 against its terms (no service yet: warn)", () => {
    const p = decodeSharedProRegTx(TESTNET_HEX).payload;
    const t: TermSheet = {
      network: "test",
      groupId: "g",
      revision: 1,
      shares: [
        { memberId: "c", label: "C", amount: 200n * COIN },
        { memberId: "a", label: "A", amount: 500n * COIN },
        { memberId: "b", label: "B", amount: 300n * COIN },
      ],
      operatorPubKey: bytesToHex(p.pubKeyOperator),
      service: "",
      votingAddress: keyIdToAddress(p.keyIDVoting, "test"),
      votingHolderId: "a",
      rewardBps: 300,
      earlyPeriodBlocks: 52560,
      earlyPenalty: 5n * COIN,
      coordinatorId: "a",
    };
    expect(validateTermSheet(t)).toEqual([]);
    const r = checkRegistrationAgainstTerms(TESTNET_HEX, t);
    expect(r.verdict).toBe("warn");
    expect(codes(r, "warn")).toEqual(["no-service"]);
    expect(codes(r, "ok")).toContain("join-sigs");
    expect(checkRegistrationAgainstTerms(TESTNET_HEX, { ...t, network: "main" }).verdict).toBe("stop");
  });
});
