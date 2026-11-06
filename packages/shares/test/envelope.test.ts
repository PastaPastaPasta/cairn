import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { addressToKeyId } from "../src/address.ts";
import { bytesToHex, hexToBytes, utf8 } from "../src/bytes.ts";
import {
  type ChainShare,
  detectMessage,
  envelopeFingerprint,
  parseSessionEnvelope,
  parseSigsEnvelope,
  parseStandbyFile,
} from "../src/envelope.ts";
import { decodeUtf8, getInt, readUniValue, withoutKey, writeUniValue } from "../src/univalue.ts";

// biome-ignore lint: fixture JSON
type J = any;
const load = (name: string): J => JSON.parse(readFileSync(new URL(`./vectors/regtest/${name}`, import.meta.url), "utf8"));
const ENVS: Array<{ name: string; text: string; fingerprint: string; unstampedText: string }> = load("envelopes.json");
const A: J = load("mn-a.json");
const env = (name: string) => ENVS.find((e) => e.name === name)!.text;

const write2 = (text: string) => decodeUtf8(writeUniValue(readUniValue(text)!, 2));

describe("UniValue port", () => {
  test("write(2) of every Core-written envelope reproduces it byte for byte", () => {
    for (const e of ENVS) {
      expect(write2(e.text), e.name).toBe(e.text);
      expect(decodeUtf8(writeUniValue(withoutKey(readUniValue(e.text)!, "fingerprint"), 2)), e.name).toBe(e.unstampedText);
    }
  });

  test("pretty-print layout: empty containers, nesting, separators", () => {
    expect(write2('{"a":[],"b":{},"c":[1,{"d":[]}],"e":null,"f":true}')).toBe(
      '{\n  "a": [\n  ],\n  "b": {\n  },\n  "c": [\n    1,\n    {\n      "d": [\n      ]\n    }\n  ],\n  "e": null,\n  "f": true\n}',
    );
    expect(write2("[]")).toBe("[\n]");
    expect(decodeUtf8(writeUniValue(readUniValue('{"a": [1, 2]}')!, 0))).toBe('{"a":[1,2]}');
  });

  test("numbers keep their raw token; strings re-escape like json_escape", () => {
    expect(write2('{"a":1.50,"b":-0,"c":1E+2}')).toBe('{\n  "a": 1.50,\n  "b": -0,\n  "c": 1E+2\n}');
    expect(write2('["\\u00e9\\/\\b\\f\\n\\r\\t\\u0001\\u007f\\"\\\\", "\\ud83d\\ude00"]')).toBe(
      '[\n  "é/\\b\\f\\n\\r\\t\\u0001\\u007f\\"\\\\",\n  "😀"\n]',
    );
  });

  test("accepts what UniValue accepts, including overlong UTF-8", () => {
    const overlong = Uint8Array.of(0x5b, 0x22, 0xc0, 0x80, 0x22, 0x5d); // ["<C0 80>"]
    expect(bytesToHex(writeUniValue(readUniValue(overlong)!))).toBe(bytesToHex(utf8('["\\u0000"]')));
    expect(readUniValue("  1 ")).toEqual({ type: "num", raw: "1" });
    expect(readUniValue('"x"')?.type).toBe("str");
    expect(readUniValue("[" + "[".repeat(511) + "]".repeat(512))).toBeDefined();
    expect(readUniValue("[".repeat(513) + "]".repeat(513))).toBeUndefined();
  });

  test("rejects what UniValue rejects", () => {
    for (const bad of [
      "",
      "[1,]",
      '{"a":1,}',
      "[01]",
      "[1.]",
      "[1e]",
      "[-]",
      '["a\nb"]',
      '["\\x"]',
      '["\\ud800"]',
      '["\\udc00"]',
      "[nul]",
      "{} x",
      '{"a" 1}',
      '{"a":1 "b":2}',
      "[,1]",
      "{1:2}",
      '["\\u12"]',
    ]) {
      expect(readUniValue(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(readUniValue(Uint8Array.of(0x22, 0xff, 0x22))).toBeUndefined();
    expect(readUniValue(Uint8Array.of(0x22, 0xc3, 0x22))).toBeUndefined();
  });

  test("WithoutFingerprint rebuilds with pushKV: duplicates keep first position, last value", () => {
    const v = readUniValue('{"a":1,"fingerprint":"X","b":2,"a":3,"fingerprint":"Y"}')!;
    expect(decodeUtf8(writeUniValue(withoutKey(v, "fingerprint")))).toBe('{"a":3,"b":2}');
    // and the fingerprint is computed over exactly that
    expect(envelopeFingerprint(v)).toBe(envelopeFingerprint(readUniValue('{"a":3,"b":2}')!));
  });

  test("getInt mirrors std::from_chars over the whole token", () => {
    expect(getInt(readUniValue("5"), 32)).toBe(5n);
    expect(getInt(readUniValue("-0"), 32)).toBe(0n);
    expect(() => getInt(readUniValue("1.0"), 32)).toThrow();
    expect(() => getInt(readUniValue("1e2"), 64)).toThrow();
    expect(() => getInt(readUniValue("2147483648"), 32)).toThrow();
    expect(getInt(readUniValue("2147483648"), 64)).toBe(2147483648n);
  });
});

describe("dash-shared-mn-session (fixtures from a real v24 run)", () => {
  test("every fingerprint equals the one Core's UniValue writer produced", () => {
    for (const e of ENVS.filter((x) => !x.name.startsWith("sigs"))) {
      const r = parseSessionEnvelope(e.text);
      expect(r.ok, `${e.name}: ${r.error}`).toBe(true);
      expect(r.fingerprint).toEqual({ stamped: e.fingerprint, computed: e.fingerprint, status: "ok" });
      expect(r.sessionCode).toBe("DC88DA");
    }
  });

  test("stage-by-stage report", () => {
    const draft = parseSessionEnvelope(env("draft-invitation"));
    expect(draft.stage).toBe("draft");
    expect(draft.revision).toBe(4);
    expect(draft.rows.map((r) => r.filled)).toEqual([true, false, false]);
    expect(draft.fundingInputs.map((i) => i.contributor)).toEqual(["Alice"]);

    const frozen = parseSessionEnvelope(env("frozen"));
    expect(frozen.stageName).toBe("Terms locked");
    expect(frozen.consentHashOk).toBe(true);
    expect(frozen.payloadMatches).toBe(true);
    expect(frozen.frozen!.consentHash.hex).toBe(A.prepared.consentHash);
    expect(frozen.sigs.map((s) => s.present)).toEqual([false, false, false]);

    const signing = parseSessionEnvelope(env("signing"));
    expect(signing.sigs.map((s) => [s.present, s.valid])).toEqual([
      [true, true],
      [false, undefined],
      [false, undefined],
    ]);

    const combined = parseSessionEnvelope(env("combined"));
    expect(combined.sigs.every((s) => s.valid)).toBe(true);
    expect(combined.fundingInputs.map((i) => i.signed)).toEqual([false, false, false]);

    const funded = parseSessionEnvelope(env("fundingSigned"));
    expect(funded.fundingInputs.map((i) => i.signed)).toEqual([true, true, true]);
    expect(funded.fundingInputs.map((i) => i.contributor)).toEqual(["Alice", "Bob", "Carol"]);
    expect(funded.frozen!.txid).toBe(A.proTxHash);
  });

  const edit = (text: string, from: string | RegExp, to: string) => {
    const out = text.replace(from, to);
    expect(out).not.toBe(text);
    return out;
  };
  const restamp = (text: string) => {
    const v = readUniValue(text)!;
    return text.replace(/"fingerprint": "[0-9A-F-]+"/, `"fingerprint": "${envelopeFingerprint(v)}"`);
  };

  test("an edit after copying shows as a fingerprint mismatch (a warning, as in Core)", () => {
    const r = parseSessionEnvelope(edit(env("draft-complete"), '"revision": 9', '"revision": 10'));
    expect(r.ok).toBe(true);
    expect(r.fingerprint!.status).toBe("mismatch");
    const absent = parseSessionEnvelope(edit(env("draft-complete"), /,\n {2}"fingerprint": "[^"]+"/, ""));
    expect(absent.fingerprint!.status).toBe("absent");
    expect(absent.fingerprint!.computed).toBe(ENVS.find((e) => e.name === "draft-complete")!.fingerprint);
    const lower = parseSessionEnvelope(edit(env("draft-complete"), "434E-F58A", "434e-f58a"));
    expect(lower.fingerprint!.status).toBe("ok");
  });

  test("a re-stamped edit to a frozen session is refused: the transaction no longer matches", () => {
    const text = restamp(edit(env("frozen"), '"amount": 30000000000', '"amount": 30000000001'));
    const r = parseSessionEnvelope(text);
    expect(r.fingerprint!.status).toBe("ok");
    expect(r).toMatchObject({ ok: false, errorCode: "payload-mismatch" });
    const terms = parseSessionEnvelope(restamp(edit(env("frozen"), '"operatorReward": 500', '"operatorReward": 0')));
    expect(terms).toMatchObject({ ok: false, errorCode: "payload-mismatch" });
    expect(terms.error).toMatch(/terms shown/);
    const svc = parseSessionEnvelope(restamp(edit(env("frozen"), '"127.0.0.1:20001"', '"127.0.0.2:20001"')));
    expect(svc.errorCode).toBe("payload-mismatch");
    const svc2 = parseSessionEnvelope(restamp(edit(env("frozen"), '"127.0.0.1:20001"', '" 127.0.0.1:20001, "')));
    expect(svc2.ok).toBe(true);
  });

  test("a different consent hash or a swapped transaction is refused", () => {
    const r = parseSessionEnvelope(edit(env("frozen"), A.prepared.consentHash, "00".repeat(32)));
    expect(r).toMatchObject({ ok: false, errorCode: "consent-mismatch" });
    const other = parseSessionEnvelope(edit(env("frozen"), A.prepared.tx, A.updateShare.hex));
    expect(other.errorCode).toBe("protx-not-shared");
    const garbage = parseSessionEnvelope(edit(env("frozen"), A.prepared.tx, "zz"));
    expect(garbage.errorCode).toBe("protx-not-hex");
  });

  test("signatures: wrong ones are flagged before combine and fatal after", () => {
    const sig0 = A.signatures[0].signature;
    const sig1 = A.signatures[1].signature;
    const signing = parseSessionEnvelope(edit(env("signing"), '"shareIndex": 0', '"shareIndex": 1'));
    expect(signing.ok).toBe(true);
    expect(signing.sigs[1]).toMatchObject({ present: true, valid: false });
    const combined = parseSessionEnvelope(edit(env("combined"), sig1, sig0));
    expect(combined).toMatchObject({ ok: false, errorCode: "combined-invalid-sig" });
    expect(combined.sigs[1]!.valid).toBe(false);
    const dup = parseSessionEnvelope(edit(env("combined"), '"shareIndex": 2', '"shareIndex": 1'));
    expect(dup.errorCode).toBe("sig-duplicate");
    const funded = parseSessionEnvelope(edit(env("fundingSigned"), A.final, A.combined));
    expect(funded).toMatchObject({ ok: false, errorCode: "funding-unsigned" });
  });

  test("structural checks from fromJson", () => {
    const d = env("draft-complete");
    expect(parseSessionEnvelope("not json").errorCode).toBe("not-json");
    expect(parseSessionEnvelope('{"type":"x"}').errorCode).toBe("not-session");
    expect(parseSessionEnvelope(edit(d, '"version": 1', '"version": 2')).errorCode).toBe("version");
    expect(parseSessionEnvelope(edit(d, '"version": 1', '"version": 1.0')).errorCode).toBe("parse");
    expect(parseSessionEnvelope(edit(d, '"revision": 9', '"revision": 0')).errorCode).toBe("revision");
    expect(parseSessionEnvelope(edit(d, '"stage": "draft"', '"stage": "later"')).errorCode).toBe("stage");
    expect(parseSessionEnvelope(d, { network: "test" }).errorCode).toBe("network");
    expect(parseSessionEnvelope(edit(d, '"network": "regtest"', '"network": "testnet"')).errorCode).toBe("network");
    expect(parseSessionEnvelope(edit(d, '"earlyPenalty": 5000000000', '"earlyPenalty": -1')).errorCode).toBe("early-penalty");
    expect(parseSessionEnvelope(edit(d, '"earlyPeriodBlocks": 30', '"earlyPeriodBlocks": 4294967296')).errorCode).toBe("early-period");
    expect(parseSessionEnvelope(edit(d, /"txid": "[0-9a-f]{64}"/, '"txid": "abc"')).errorCode).toBe("contribution-malformed");
    expect(parseSessionEnvelope(edit(d, '"stage": "draft"', '"stage": "frozen"')).errorCode).toBe("missing-frozen");
    const nine = readUniValue(d)!;
    const shares = nine.type === "obj" ? nine.values[nine.keyStrings.indexOf("shares")]! : undefined;
    if (shares?.type === "arr") while (shares.values.length < 9) shares.values.push(shares.values[0]!);
    expect(parseSessionEnvelope(decodeUtf8(writeUniValue(nine, 2))).errorCode).toBe("too-many-shares");
    expect(parseSessionEnvelope("{" + " ".repeat(2 * 1024 * 1024) + "}").errorCode).toBe("too-large");
    // Qt trims surrounding whitespace before reading
    expect(parseSessionEnvelope(`\n\t ${d}  \n`).ok).toBe(true);
  });

  test("rows with addresses that do not decode on the network are reported", () => {
    const r = parseSessionEnvelope(edit(env("draft-complete"), A.prepareArgs.shares[1].refundAddress, "yNotAnAddress"));
    expect(r.rows[1]!.badAddresses).toEqual(["refund"]);
  });
});

describe("detectMessage (SharedMnImport::Detect)", () => {
  test("routes every artifact", () => {
    expect(detectMessage(env("combined")).kind).toBe("session");
    expect(detectMessage(env("sigs-dissolve")).kind).toBe("sigs");
    expect(detectMessage(`  ${A.standby.full}\n`).kind).toBe("standbyHex");
    expect(detectMessage(A.final)).toMatchObject({ kind: "unknown", error: expect.stringMatching(/not a shared masternode dissolution/) });
    expect(detectMessage('{"type":"other"}')).toMatchObject({ kind: "unknown" });
    expect(detectMessage("   ").kind).toBe("unknown");
  });
});

const chainShares: ChainShare[] = A.protxInfo.state.shares.map((s: J) => ({
  amount: BigInt(s.amount),
  scriptRefund: hexToBytes(s.refundScript),
  keyIDOwner: addressToKeyId(s.ownerAddress, "regtest")!,
}));

describe("dash-shared-mn-sigs", () => {
  test("dissolve approvals verify against the on-chain share owners", () => {
    const r = parseSigsEnvelope(env("sigs-dissolve"), { network: "regtest", proTxHash: A.proTxHash, shares: chainShares });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("dissolve");
    expect(r.fingerprint!.status).toBe("ok");
    expect(r.signHash!.hex).toBe(A.unanimousDissolve.prepared.signHash);
    expect(r.dissolution!.reading!.returnsPrincipal).toBe(true);
    expect(r.signatures.map((s) => s.valid)).toEqual([true, true, true]);
  });

  test("registrar approvals verify; request without signatures", () => {
    const r = parseSigsEnvelope(env("sigs-registrar"), { shares: chainShares });
    expect(r.ok).toBe(true);
    expect(r.signHash!.hex).toBe(A.updateRegistrar.prepared.signHash);
    expect(r.signatures.map((s) => s.valid)).toEqual([true, true, true]);
    const req = parseSigsEnvelope(env("sigs-registrar-request"));
    expect(req.ok).toBe(true);
    expect(req.signatures).toEqual([]);
    expect(req.fingerprint!.status).toBe("ok");
  });

  test("refusals", () => {
    expect(parseSigsEnvelope(env("sigs-dissolve"), { network: "main" }).error).toMatch(/network/);
    expect(parseSigsEnvelope(env("sigs-dissolve"), { proTxHash: "00".repeat(32) }).error).toMatch(/different masternode/);
    const swapped = env("sigs-dissolve").replace(A.unanimousDissolve.prepared.tx, A.updateRegistrar.prepared.tx);
    expect(parseSigsEnvelope(swapped).error).toMatch(/not a dissolution/);
    const wrongSig = env("sigs-dissolve").replace(A.unanimousDissolve.signatures[0].signature, A.unanimousDissolve.signatures[1].signature);
    const r = parseSigsEnvelope(wrongSig, { shares: chainShares });
    expect(r.signatures.map((s) => s.valid)).toEqual([false, true, true]);
    expect(r.fingerprint!.status).toBe("mismatch");
  });
});

describe("standby dissolution file", () => {
  // DissolveDialog::standbyFileText layout, filled with this run's transactions
  const text = [
    "Dash shared masternode — standby dissolution",
    `Masternode: ${A.proTxHash}`,
    "Share 3 of 3 (Carol)",
    "Created: 2026-11-06",
    "",
    'Each block below is a complete signed transaction. Broadcast one of them with "sendrawtransaction" only when you want to end the masternode and get your principal back. They never expire. Store this file with your refund-address backup, separately from the wallet.',
    "",
    `FULL PRINCIPAL — valid from block ${A.registeredBlock.height + 30} (~11/7/26, 10:00 AM)`,
    A.standby.full,
    "",
    "IMMEDIATE — pays the 50 DASH early-exit penalty, valid right away",
    A.standby.immediate,
    "",
  ].join("\n");

  test("finds both transactions and checks them against the share table", () => {
    const f = parseStandbyFile(text, chainShares);
    expect(f.proTxHash).toBe(A.proTxHash);
    expect(f.validFromHeight).toBe(142);
    expect(f.full!.txid).toBe(f.transactions[0]!.txid);
    expect(f.full!.reading!.returnsPrincipal).toBe(true);
    expect(f.immediate!.reading!.bonuses.slice(0, 2)).toEqual([3125000000n, 1875000000n]);
    expect([f.full!.sigs![0]!.valid, f.immediate!.sigs![0]!.valid]).toEqual([true, true]);
    expect(f.immediate!.txid).toBe(A.dissolved.txid);
  });

  test("translated headers fall back to file order", () => {
    const f = parseStandbyFile(text.replace("FULL PRINCIPAL", "CAPITAL COMPLETO").replace("IMMEDIATE", "INMEDIATA"));
    expect(f.full!.txid).toBe(parseStandbyFile(text).full!.txid);
    expect(f.immediate!.txid).toBe(A.dissolved.txid);
    expect(f.full!.reading).toBeUndefined();
  });
});

test("fingerprint helper equals Core for the sigs envelopes too", () => {
  for (const e of ENVS.filter((x) => x.name.startsWith("sigs"))) {
    expect(envelopeFingerprint(readUniValue(e.text)!)).toBe(e.fingerprint);
  }
  expect(bytesToHex(utf8("é"))).toBe("c3a9");
});
