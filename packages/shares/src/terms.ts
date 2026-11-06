import { decodeAddress, isNetwork, type Network } from "./address.ts";
import { bytesToHex, sha256, utf8 } from "./bytes.ts";
import { parseServiceEntry } from "./netinfo.ts";
import {
  MAX_SHARES,
  MIN_SHARES,
  REGULAR_COLLATERAL,
  areShareAmountsValid,
  isEarlyPenaltyValid,
  isEarlyPeriodValid,
  isOperatorRewardValid,
} from "./rules.ts";

export const TERMS_DOMAIN = "cairn-terms-v1\n";

export interface TermShare {
  /** Platform identity of the member */
  memberId: string;
  /** the row label typed into Dash-Qt's Participants page */
  label: string;
  /** duffs */
  amount: bigint;
}

/** The Cairn term sheet (DESIGN.md §7): what every member approves before any Dash-Qt message exists */
export interface TermSheet {
  network: Network;
  groupId: string;
  revision: number;
  /** in roster order */
  shares: TermShare[];
  /** 96 lower-case hex characters (48-byte BLS public key, basic scheme) */
  operatorPubKey: string;
  /** "ip:port", or "" when the operator sets the service later with ProUpServTx */
  service: string;
  /** P2PKH address of the masternode's voting key */
  votingAddress: string;
  votingHolderId: string;
  /** operator reward in basis points, 0..10000 (permanent for the masternode) */
  rewardBps: number;
  earlyPeriodBlocks: number;
  /** duffs */
  earlyPenalty: bigint;
  coordinatorId: string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function toCanonicalValue(v: unknown): Json {
  if (typeof v === "bigint") return v.toString();
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new RangeError("term sheet numbers must be safe integers");
    return v;
  }
  if (Array.isArray(v)) return v.map(toCanonicalValue);
  if (typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = toCanonicalValue(x);
    }
    return out;
  }
  throw new TypeError(`unsupported value in term sheet: ${typeof v}`);
}

function stringify(v: Json): string {
  if (Array.isArray(v)) return "[" + v.map(stringify).join(",") + "]";
  if (v !== null && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stringify(v[k]!)).join(",") + "}";
  }
  return JSON.stringify(v);
}

/**
 * Deterministic JSON: keys sorted (UTF-16 code unit order) at every level, no whitespace,
 * bigints as decimal strings, array order kept, standard JSON string escaping.
 */
export function canonicalize(terms: TermSheet): string {
  // Only the term sheet's own fields, so extra properties on the object can never change the hash
  const t: TermSheet = {
    network: terms.network,
    groupId: terms.groupId,
    revision: terms.revision,
    shares: terms.shares.map((s) => ({ memberId: s.memberId, label: s.label, amount: s.amount })),
    operatorPubKey: terms.operatorPubKey,
    service: terms.service,
    votingAddress: terms.votingAddress,
    votingHolderId: terms.votingHolderId,
    rewardBps: terms.rewardBps,
    earlyPeriodBlocks: terms.earlyPeriodBlocks,
    earlyPenalty: terms.earlyPenalty,
    coordinatorId: terms.coordinatorId,
  };
  return stringify(toCanonicalValue(t));
}

/** termsHash = sha256("cairn-terms-v1\n" + canonicalJson), lower-case hex */
export function termsHash(terms: TermSheet): string {
  return bytesToHex(sha256(utf8(TERMS_DOMAIN + canonicalize(terms))));
}

export interface TermIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * Validate a term sheet: Dash Core's consensus rules for the share table and early-exit terms,
 * plus Cairn's stricter policy that a penalty is set exactly when there is an early period
 * (Core only requires penalty 0 without a period; a zero penalty inside a period is a free exit).
 */
export function validateTermSheet(t: TermSheet): TermIssue[] {
  const issues: TermIssue[] = [];
  const add = (field: string, code: string, message: string) => issues.push({ field, code, message });

  if (!isNetwork(t.network)) add("network", "network", 'Network must be "main", "test", "devnet" or "regtest".');
  if (typeof t.groupId !== "string" || t.groupId === "") add("groupId", "required", "The group id is missing.");
  if (!Number.isSafeInteger(t.revision) || t.revision < 1) add("revision", "revision", "The revision must be a whole number from 1.");

  if (!Array.isArray(t.shares) || t.shares.length < MIN_SHARES || t.shares.length > MAX_SHARES) {
    add("shares", "bad-protx-shares-count", `A shared masternode needs between ${MIN_SHARES} and ${MAX_SHARES} shares.`);
  } else {
    const amounts = areShareAmountsValid(t.shares.map((s) => s.amount), REGULAR_COLLATERAL);
    if (!amounts.ok) add("shares", amounts.reason, amounts.message);
    const labels = new Set<string>();
    const members = new Set<string>();
    t.shares.forEach((s, i) => {
      if (typeof s.memberId !== "string" || s.memberId === "") add(`shares[${i}].memberId`, "required", `Share ${i + 1} has no member.`);
      else if (members.has(s.memberId)) add(`shares[${i}].memberId`, "duplicate-member", `Share ${i + 1}'s member already has a share.`);
      else members.add(s.memberId);
      const label = typeof s.label === "string" ? s.label.trim() : "";
      if (!label) add(`shares[${i}].label`, "required", `Share ${i + 1} has no label.`);
      else if (label !== s.label) add(`shares[${i}].label`, "label-whitespace", `Share ${i + 1}'s label has leading or trailing spaces.`);
      else if (labels.has(label)) add(`shares[${i}].label`, "duplicate-label", `Two shares are labelled "${label}".`);
      labels.add(label);
      if (typeof s.amount !== "bigint") add(`shares[${i}].amount`, "amount-type", `Share ${i + 1}'s amount must be a bigint of duffs.`);
    });
  }

  if (typeof t.operatorPubKey !== "string" || !/^[0-9a-f]{96}$/.test(t.operatorPubKey)) {
    add("operatorPubKey", "operator-key", "The operator key must be 96 lower-case hex characters (a BLS public key).");
  }
  if (t.service !== "") {
    const e = typeof t.service === "string" ? parseServiceEntry(t.service) : undefined;
    if (!e) add("service", "service", 'The service must be "IPv4:port" or "[IPv6]:port", or empty.');
    else if (t.network === "main" && (e.type !== "service" || e.net !== "ipv4" || e.port !== 9999)) {
      add("service", "service-mainnet", "On mainnet the service must be an IPv4 address with port 9999.");
    }
  }
  const voting = typeof t.votingAddress === "string" && isNetwork(t.network) ? decodeAddress(t.votingAddress, t.network) : undefined;
  if (voting?.type !== "p2pkh") add("votingAddress", "voting-address", "The voting address must be a P2PKH address on this network.");
  if (typeof t.votingHolderId !== "string" || t.votingHolderId === "") add("votingHolderId", "required", "Nobody holds the voting key.");
  if (typeof t.coordinatorId !== "string" || t.coordinatorId === "") add("coordinatorId", "required", "There is no coordinator.");
  if (!isOperatorRewardValid(t.rewardBps)) add("rewardBps", "bad-protx-operator-reward", "The operator reward must be 0 to 100%.");

  const period = isEarlyPeriodValid(t.earlyPeriodBlocks);
  if (!period.ok) add("earlyPeriodBlocks", period.reason, period.message);
  if (typeof t.earlyPenalty !== "bigint") {
    add("earlyPenalty", "amount-type", "The early-exit penalty must be a bigint of duffs.");
  } else if (Array.isArray(t.shares) && t.shares.length > 0 && period.ok) {
    const min = t.shares.reduce((m, s) => (s.amount < m ? s.amount : m), t.shares[0]!.amount);
    const pen = isEarlyPenaltyValid(t.earlyPeriodBlocks, t.earlyPenalty, min);
    if (!pen.ok) add("earlyPenalty", pen.reason, pen.message);
    else if (t.earlyPeriodBlocks > 0 && t.earlyPenalty === 0n) {
      add("earlyPenalty", "penalty-required", "Set an early-exit penalty, or set the early period to 0 (a zero penalty makes the period meaningless).");
    }
  }
  return issues;
}

export class TermSheetError extends Error {
  override name = "TermSheetError";
}

/**
 * Read a term sheet from its canonical JSON (or an equivalent object) back into typed form:
 * amounts and the penalty must be decimal strings of duffs.
 */
export function parseTermSheet(input: string | Record<string, unknown>): TermSheet {
  const o = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown>;
  const duffs = (v: unknown, field: string): bigint => {
    if (typeof v === "bigint") return v;
    if (typeof v === "string" && /^(0|[1-9]\d*)$/.test(v)) return BigInt(v);
    throw new TermSheetError(`${field} must be a decimal string of duffs`);
  };
  const s = (v: unknown, field: string): string => {
    if (typeof v !== "string") throw new TermSheetError(`${field} must be a string`);
    return v;
  };
  const n = (v: unknown, field: string): number => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new TermSheetError(`${field} must be an integer`);
    return v;
  };
  if (!Array.isArray(o["shares"])) throw new TermSheetError("shares must be an array");
  const network = s(o["network"], "network");
  if (!isNetwork(network)) throw new TermSheetError("unknown network");
  return {
    network,
    groupId: s(o["groupId"], "groupId"),
    revision: n(o["revision"], "revision"),
    shares: (o["shares"] as Array<Record<string, unknown>>).map((x, i) => ({
      memberId: s(x["memberId"], `shares[${i}].memberId`),
      label: s(x["label"], `shares[${i}].label`),
      amount: duffs(x["amount"], `shares[${i}].amount`),
    })),
    operatorPubKey: s(o["operatorPubKey"], "operatorPubKey"),
    service: s(o["service"], "service"),
    votingAddress: s(o["votingAddress"], "votingAddress"),
    votingHolderId: s(o["votingHolderId"], "votingHolderId"),
    rewardBps: n(o["rewardBps"], "rewardBps"),
    earlyPeriodBlocks: n(o["earlyPeriodBlocks"], "earlyPeriodBlocks"),
    earlyPenalty: duffs(o["earlyPenalty"], "earlyPenalty"),
    coordinatorId: s(o["coordinatorId"], "coordinatorId"),
  };
}
