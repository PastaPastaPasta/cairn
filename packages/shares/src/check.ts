import { decodeAddress, scriptToAddress } from "./address.ts";
import { formatDash } from "./amounts.ts";
import { bytesToHex, equalBytes } from "./bytes.ts";
import { verifyJoinSigs } from "./consent.ts";
import { type SessionReport, parseSessionEnvelope, stageIndex } from "./envelope.ts";
import { type NetInfo, encodeNetInfo, isNetInfoEmpty, netInfoFromServiceList } from "./netinfo.ts";
import { MnType, type ProRegTxPayload, ProTxVersion, decodeSharedProRegTx } from "./proregtx.ts";
import { isShareListTriviallyValid } from "./rules.ts";
import type { TermSheet } from "./terms.ts";

export type Level = "ok" | "info" | "warn" | "stop";
export type Verdict = "ok" | "warn" | "stop";

export interface Finding {
  level: Level;
  /** stable machine code */
  code: string;
  /** plain-language headline for a normal user */
  title: string;
  /** technical detail for the "Technical details" disclosure */
  detail: string;
}

export interface CheckResult {
  verdict: Verdict;
  /** envelope stage, or "registration" for an on-chain ProRegTx check */
  stage: string;
  findings: Finding[];
}

const dash = (d: bigint) => formatDash(d, { unit: "DASH" });

class Findings {
  list: Finding[] = [];
  add(level: Level, code: string, title: string, detail = ""): void {
    this.list.push({ level, code, title, detail });
  }
  result(stage: string): CheckResult {
    const verdict: Verdict = this.list.some((f) => f.level === "stop")
      ? "stop"
      : this.list.some((f) => f.level === "warn")
        ? "warn"
        : "ok";
    return { verdict, stage, findings: this.list };
  }
}

function serviceEncoding(text: string): string | undefined {
  const ni = netInfoFromServiceList(text);
  return ni ? bytesToHex(encodeNetInfo(ni)) : undefined;
}

function sameService(termsService: string, other: string): boolean {
  const a = serviceEncoding(termsService);
  const b = serviceEncoding(other);
  return a !== undefined && a === b;
}

function netInfoMatchesTerms(ni: NetInfo, service: string): boolean {
  if (service === "") return isNetInfoEmpty(ni);
  const expected = netInfoFromServiceList(service);
  return ni.kind === "ext" && expected !== undefined && equalBytes(encodeNetInfo(expected), encodeNetInfo(ni));
}

function earlyTermsFindings(f: Findings, terms: TermSheet): void {
  if (terms.earlyPeriodBlocks === 0) {
    f.add(
      "warn",
      "no-early-period",
      "Anyone can leave at any time",
      "earlyPeriodBlocks is 0, so the early-exit penalty is 0: any co-owner can dissolve the masternode at any time, paying only the network fee. Every principal is still refunded.",
    );
  }
}

function amountsMultiset(xs: readonly bigint[]): string {
  return [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",");
}

/**
 * Check a pasted `dash-shared-mn-session` message against the term sheet everyone approved.
 * Any difference in amounts, operator, service, voting address, operator reward, early-exit
 * terms or network is a stop; for stages past the draft the prepared transaction itself is
 * decoded and must match both the message and the term sheet, with a valid consent hash.
 */
export function checkEnvelopeAgainstTerms(
  envelope: string | SessionReport,
  terms: TermSheet,
  opts: { myLabel?: string } = {},
): CheckResult {
  const f = new Findings();
  const report = typeof envelope === "string" ? parseSessionEnvelope(envelope) : envelope;
  const env = report.envelope;
  if (!env) {
    const network = report.errorCode === "network";
    f.add(
      "stop",
      network ? "network" : "unreadable",
      network ? "This message is for a different network" : "This is not a valid Dash-Qt shared masternode message",
      report.error ?? "",
    );
    return f.result(report.stage ?? "unknown");
  }
  const stage = env.stage;
  f.add("info", "stage", `${report.stageName} · Session ${report.sessionCode} · revision ${env.revision}`, `stage=${stage}`);

  if (env.network !== terms.network) {
    f.add("stop", "network", "This message is for a different network", `message network "${env.network}", agreed "${terms.network}"`);
  }

  const fp = report.fingerprint!;
  if (fp.status === "mismatch") {
    f.add(
      "warn",
      "fingerprint-mismatch",
      "This message was edited after it was copied",
      `The message says Code ${fp.stamped} but its content gives Code ${fp.computed}. Ask the sender for a fresh copy and compare codes.`,
    );
  } else if (fp.status === "ok") {
    f.add("ok", "fingerprint", `Message code ${fp.computed}`, "Compare this code with the one the sender sees in Dash-Qt.");
  } else {
    f.add("info", "fingerprint-absent", "This message has no code", `Its content gives Code ${fp.computed}.`);
  }

  if (!report.ok) {
    f.add("stop", `core-${report.errorCode}`, "Dash Core would refuse this message", report.error ?? "");
  }

  // Shares: match by label and amount; order may differ
  const envLabels = env.shares.map((s) => s.label.trim());
  const dupLabels = envLabels.filter((l, i) => envLabels.indexOf(l) !== i);
  if (dupLabels.length) {
    f.add("stop", "duplicate-labels", "Two rows in the message have the same name", `duplicate labels: ${[...new Set(dupLabels)].join(", ")}`);
  }
  const used = new Set<number>();
  let sharesOk = env.shares.length === terms.shares.length;
  let inOrder = true;
  terms.shares.forEach((ts, ti) => {
    const want = ts.label.trim();
    let idx = envLabels.findIndex((l, i) => !used.has(i) && l === want);
    if (idx < 0) idx = envLabels.findIndex((l, i) => !used.has(i) && l.toLowerCase() === want.toLowerCase());
    if (idx < 0) {
      sharesOk = false;
      f.add("stop", "share-missing", `${ts.label}'s share is missing`, `No row labelled "${ts.label}" (agreed ${dash(ts.amount)}).`);
      return;
    }
    used.add(idx);
    if (idx !== ti) inOrder = false;
    const row = env.shares[idx]!;
    if (row.amount !== ts.amount) {
      sharesOk = false;
      f.add(
        "stop",
        "share-amount",
        `${ts.label}'s share amount is not what was agreed`,
        `Row ${idx + 1} "${row.label}" has ${dash(row.amount)}; agreed ${dash(ts.amount)}.`,
      );
    }
  });
  env.shares.forEach((row, i) => {
    if (!used.has(i)) {
      sharesOk = false;
      f.add("stop", "share-extra", `The message has a share nobody agreed to: "${row.label}"`, `Row ${i + 1}: ${dash(row.amount)}.`);
    }
  });
  if (sharesOk) {
    f.add("ok", "shares", "Every share matches what was agreed", env.shares.map((s) => `${s.label}: ${dash(s.amount)}`).join("; "));
    if (!inOrder) {
      f.add("info", "share-order", "The rows are in a different order than agreed", "Order does not change anyone's share; rewards are split by amount.");
    }
  }

  // Masternode-wide terms
  const t = env.terms;
  if (t.operatorPubKey.toLowerCase() !== terms.operatorPubKey.toLowerCase()) {
    f.add("stop", "operator-key", "The operator key is not the agreed operator's", `message ${t.operatorPubKey || "(empty)"}, agreed ${terms.operatorPubKey}`);
  }
  if (!(t.coreP2PAddrs.trim() === "" && terms.service === "") && !sameService(terms.service, t.coreP2PAddrs)) {
    f.add("stop", "service", "The masternode's IP address is not the agreed one", `message "${t.coreP2PAddrs}", agreed "${terms.service}"`);
  }
  if (t.votingAddress !== terms.votingAddress) {
    f.add("stop", "voting-address", "The voting address is not the agreed one", `message ${t.votingAddress || "(empty)"}, agreed ${terms.votingAddress}`);
  }
  if (t.operatorReward !== terms.rewardBps) {
    f.add(
      "stop",
      "operator-reward",
      "The operator reward is not what was agreed",
      `message ${t.operatorReward / 100}%, agreed ${terms.rewardBps / 100}% (permanent for this masternode)`,
    );
  }
  if (t.earlyPeriodBlocks !== terms.earlyPeriodBlocks || t.earlyPenalty !== terms.earlyPenalty) {
    f.add(
      "stop",
      "early-terms",
      "The early-exit terms are not what was agreed",
      `message ${t.earlyPeriodBlocks} blocks / ${dash(t.earlyPenalty)}, agreed ${terms.earlyPeriodBlocks} blocks / ${dash(terms.earlyPenalty)}`,
    );
  }
  earlyTermsFindings(f, terms);

  report.rows.forEach((r) => {
    if (r.badAddresses.length) {
      f.add("warn", "bad-address", `${r.label || `Row ${r.index + 1}`} has an address that is not valid here`, `invalid: ${r.badAddresses.join(", ")}`);
    }
  });
  const unfilled = report.rows.filter((r) => !r.filled);
  if (unfilled.length) {
    f.add("info", "rows-unfilled", `Waiting for ${unfilled.map((r) => r.label || `row ${r.index + 1}`).join(", ")} to fill in their row`, "");
  }

  // My row
  if (opts.myLabel !== undefined) {
    const mine = terms.shares.find((s) => s.label.trim() === opts.myLabel!.trim());
    const myIdx = envLabels.findIndex((l) => l === opts.myLabel!.trim());
    if (!mine) {
      f.add("stop", "my-terms-missing", "Your share is not in the agreed terms", `label "${opts.myLabel}"`);
    } else if (myIdx < 0) {
      f.add("stop", "my-row-missing", "Your share is missing from this message", `No row labelled "${opts.myLabel}".`);
    } else {
      const row = env.shares[myIdx]!;
      if (row.amount !== mine.amount) {
        f.add("stop", "my-amount", "Your share amount is not what you agreed", `message ${dash(row.amount)}, agreed ${dash(mine.amount)}`);
      } else {
        f.add("ok", "my-row", `Your share: ${dash(row.amount)}`, `row ${myIdx + 1}`);
      }
      if (row.ownerAddress || row.refundAddress) {
        f.add(
          "info",
          "my-addresses",
          "Check your addresses in your wallet",
          `owner ${row.ownerAddress || "-"}, refund ${row.refundAddress || "-"}, reward ${row.rewardAddress || "(refund address)"}. Cairn cannot see your wallet; Dash-Qt checks they are yours.`,
        );
      }
      const contribution = env.contributions.find((c) => c.label.trim() === opts.myLabel!.trim());
      if (contribution) {
        f.add(
          "info",
          "my-contribution",
          "Check your coins and change in your wallet",
          `inputs ${contribution.inputs.map((i) => `${i.txid}:${i.vout}`).join(", ")}; change ${
            contribution.change ? `${dash(contribution.change.amount)} to ${contribution.change.address}` : "none"
          }`,
        );
      }
      const sig = report.sigs[myIdx];
      if (sig?.present) {
        f.add(sig.valid === false ? "warn" : "info", "my-approval", sig.valid === false ? "Your approval is no longer valid" : "Your approval is included", sig.reason ?? "");
      }
    }
  }

  // Past the draft: the prepared transaction itself
  if (stageIndex(stage) > 0 && report.frozen) {
    const p = report.frozen.payload;
    if (report.consentHashOk) {
      f.add("ok", "consent-hash", "The prepared transaction matches its consent code", `consentHash ${report.frozen.consentHash.hex}`);
    } else {
      f.add("stop", "consent-hash", "The prepared transaction does not match what people approve", `computed ${report.frozen.consentHash.hex}, message ${env.consentHash}`);
    }
    if (report.payloadMatches) {
      f.add("ok", "payload-matches", "The prepared transaction registers exactly what this message shows", "");
    } else {
      f.add("stop", "payload-mismatch", "The prepared transaction does not match this message", report.payloadMismatch ?? "");
    }
    payloadVsTerms(f, p, terms);
    const present = report.sigs.filter((s) => s.present);
    const valid = present.filter((s) => s.valid);
    f.add("info", "approvals", `${valid.length} of ${report.sigs.length} approvals`, report.sigs.map((s) => `${s.label}: ${s.present ? (s.valid ? "valid" : "INVALID") : "missing"}`).join("; "));
    for (const s of present.filter((x) => !x.valid)) {
      f.add("warn", "approval-invalid", `${s.label}'s approval does not match these terms`, s.reason ?? "");
    }
    const signed = report.fundingInputs.filter((i) => i.signed).length;
    if (stageIndex(stage) >= stageIndex("combined")) {
      f.add("info", "funding-signed", `${signed} of ${report.fundingInputs.length} funding inputs signed`, report.fundingInputs.map((i) => `${i.contributor ?? "?"} ${i.txid.slice(0, 8)}:${i.vout} ${i.signed ? "signed" : "unsigned"}`).join("; "));
    }
  }

  return f.result(stage);
}

function payloadVsTerms(f: Findings, p: ProRegTxPayload, terms: TermSheet): void {
  const net = terms.network;
  if (amountsMultiset(p.shares.map((s) => s.amount)) !== amountsMultiset(terms.shares.map((s) => s.amount))) {
    f.add("stop", "tx-share-amounts", "The transaction's share amounts are not the agreed ones", p.shares.map((s) => dash(s.amount)).join(", "));
  }
  if (bytesToHex(p.pubKeyOperator) !== terms.operatorPubKey.toLowerCase()) {
    f.add("stop", "tx-operator-key", "The transaction's operator key is not the agreed one", bytesToHex(p.pubKeyOperator));
  }
  const voting = decodeAddress(terms.votingAddress, net);
  if (voting?.type !== "p2pkh" || !equalBytes(voting.hash, p.keyIDVoting)) {
    f.add("stop", "tx-voting", "The transaction's voting key is not the agreed one", `keyIDVoting ${bytesToHex(p.keyIDVoting)}`);
  }
  if (p.operatorReward !== terms.rewardBps) {
    f.add("stop", "tx-reward", "The transaction's operator reward is not the agreed one", `${p.operatorReward} bps`);
  }
  if (p.earlyPeriodBlocks !== terms.earlyPeriodBlocks || p.earlyPenalty !== terms.earlyPenalty) {
    f.add("stop", "tx-early", "The transaction's early-exit terms are not the agreed ones", `${p.earlyPeriodBlocks} blocks / ${dash(p.earlyPenalty)}`);
  }
  if (!netInfoMatchesTerms(p.netInfo, terms.service)) {
    f.add("stop", "tx-service", "The transaction's IP address is not the agreed one", "");
  }
  if (p.mnType !== MnType.Regular) f.add("stop", "tx-type", "This is not a regular masternode registration", `nType ${p.mnType}`);
}

/**
 * Check a broadcast shared ProRegTx (e.g. fetched by its proTxHash) against the term sheet:
 * share amounts (order-insensitive), operator key, voting key, operator reward, early-exit terms
 * and service, that consensus share-table rules hold, and that every joinSig verifies.
 */
export function checkRegistrationAgainstTerms(
  proRegTxHex: string,
  terms: TermSheet,
  opts: { proTxHash?: string } = {},
): CheckResult {
  const f = new Findings();
  let d: ReturnType<typeof decodeSharedProRegTx>;
  try {
    d = decodeSharedProRegTx(proRegTxHex.trim());
  } catch (e) {
    f.add("stop", "not-shared-protx", "This is not a shared masternode registration", e instanceof Error ? e.message : String(e));
    return f.result("registration");
  }
  const p = d.payload;
  f.add("info", "protx", `Registration ${d.txid.slice(0, 8)}…`, `proTxHash ${d.txid}, collateral output ${d.collateralIndex}`);
  if (opts.proTxHash !== undefined && opts.proTxHash.toLowerCase() !== d.txid) {
    f.add("stop", "protx-hash", "This is not the registration that was linked", `expected ${opts.proTxHash}, got ${d.txid}`);
  }
  if (p.version !== ProTxVersion.ExtAddr) f.add("stop", "version", "Unexpected registration version", `nVersion ${p.version}`);

  payloadVsTerms(f, p, terms);
  if (amountsMultiset(p.shares.map((s) => s.amount)) === amountsMultiset(terms.shares.map((s) => s.amount))) {
    const ordered = p.shares.every((s, i) => s.amount === terms.shares[i]?.amount);
    f.add("ok", "shares", "Every share amount matches what was agreed", p.shares.map((s) => dash(s.amount)).join(", "));
    if (!ordered) f.add("info", "share-order", "The shares are in a different order than agreed", "Order does not change anyone's share.");
  }
  const rules = isShareListTriviallyValid(p.shares, p.earlyPeriodBlocks, p.earlyPenalty, p.keyIDVoting);
  if (!rules.ok) f.add("stop", rules.reason, "The share table breaks Dash Core's rules", rules.message);

  const { consentHash, results } = verifyJoinSigs(d.tx, p);
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    f.add("stop", "join-sigs", "Not every co-owner's approval is valid", bad.map((r) => `share ${r.shareIndex + 1}: ${r.reason}`).join("; "));
  } else {
    f.add("ok", "join-sigs", `All ${results.length} co-owner approvals are valid`, `consentHash ${consentHash.hex}`);
  }
  if (isNetInfoEmpty(p.netInfo)) {
    f.add(
      "warn",
      "no-service",
      "No IP address registered yet",
      "The masternode is PoSe-banned (earns nothing) until the operator sends protx update_service.",
    );
  }
  earlyTermsFindings(f, terms);
  f.add(
    "info",
    "addresses",
    "Share addresses (public on chain)",
    p.shares
      .map((s, i) => `share ${i + 1}: ${dash(s.amount)} refund ${scriptToAddress(s.scriptRefund, terms.network) ?? bytesToHex(s.scriptRefund)}`)
      .join("; "),
  );
  return f.result("registration");
}
