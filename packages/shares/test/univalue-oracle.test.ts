/**
 * UniValue edge cases echoed through a real dashd 24.0.0 (vectors/univalue/generate.sh): what
 * dash-cli's UniValue parser accepts, and the exact write(2) bytes it prints.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { bytesToHex } from "../src/bytes.ts";
import { readUniValue, writeUniValue } from "../src/univalue.ts";

const CASES: Array<{ input: string; accepted: boolean; output?: string; error?: string }> = JSON.parse(
  readFileSync(new URL("./vectors/univalue/cases.json", import.meta.url), "utf8"),
);
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

test.each(CASES.map((c) => [Buffer.from(c.input, "base64").toString("latin1"), c] as const))("%j", (_, c) => {
  const parsed = readUniValue(b64(c.input));
  // "-" is accepted by the client's parser and only refused by the node (JSON-RPC parse error)
  const clientAccepted = c.accepted || /Parse error/.test(c.error ?? "");
  expect(parsed !== undefined).toBe(clientAccepted);
  if (c.accepted) {
    const written = writeUniValue({ type: "arr", values: [parsed!] }, 2);
    expect(bytesToHex(written)).toBe(bytesToHex(b64(c.output!)));
  }
});
