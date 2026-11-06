import { addressToScript, decodeAddress, isNetwork, type Network } from "./address.ts";
import { moneyRange } from "./amounts.ts";
import { type Bytes, bytesToHex, equalBytes, isHex, sha256, utf8 } from "./bytes.ts";
import {
  type Digest,
  decodeBase64Core,
  proDisSignHash,
  proUpSharedRegSignHash,
  sharedRegConsentHash,
  verifyCompactCanonical,
} from "./consent.ts";
import { netInfoMatchesServiceList } from "./netinfo.ts";
import {
  MnType,
  type ProDisTxPayload,
  type ProRegTxPayload,
  type ProUpSharedRegTxPayload,
  SHARED_COLLATERAL_SCRIPT,
  decodeProDisTxPayload,
  decodeProRegTxPayload,
  decodeProUpSharedRegTxPayload,
  isSharedPayload,
} from "./proregtx.ts";
import { REGULAR_COLLATERAL } from "./rules.ts";
import { type Tx, TxType, decodeTx, txid as txidOf } from "./tx.ts";
import {
  type UniValue,
  findValue,
  getInt,
  isNum,
  isStr,
  readUniValue,
  withoutKey,
  writeUniValue,
} from "./univalue.ts";

export const SESSION_TYPE = "dash-shared-mn-session";
export const SIGS_TYPE = "dash-shared-mn-sigs";
/** MAX_ENVELOPE_FILE_BYTES (src/qt/sharedmnwidgets.h) */
export const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRIBUTION_INPUTS = 64;
const MAX_SHARES = 8;

export const STAGES = ["draft", "frozen", "signing", "combined", "fundingSigned", "broadcast"] as const;
export type Stage = (typeof STAGES)[number];

/** MnShareSession::StageName (English) */
export const STAGE_NAMES: Record<Stage, string> = {
  draft: "Draft",
  frozen: "Terms locked",
  signing: "Collecting approvals",
  combined: "Approvals combined",
  fundingSigned: "Contributions signed",
  broadcast: "Broadcast",
};

export function stageIndex(s: Stage): number {
  return STAGES.indexOf(s);
}

export interface SessionShare {
  label: string;
  amount: bigint;
  ownerAddress: string;
  refundAddress: string;
  rewardAddress: string;
}

export interface SessionTerms {
  coreP2PAddrs: string;
  operatorPubKey: string;
  votingAddress: string;
  /** basis points */
  operatorReward: number;
  earlyPeriodBlocks: number;
  earlyPenalty: bigint;
}

export interface SessionInput {
  txid: string;
  vout: number;
  sequence: number;
}

export interface SessionContribution {
  label: string;
  inputs: SessionInput[];
  change?: { address: string; amount: bigint };
  changeIndex: number;
}

export interface SessionSig {
  shareIndex: number;
  signature: string;
}

/** The parsed `dash-shared-mn-session` v1 envelope (MnShareSession fields, Core defaults when absent) */
export interface SessionEnvelope {
  network: string;
  sessionId: string;
  revision: number;
  stage: Stage;
  fundingTx: string;
  shares: SessionShare[];
  terms: SessionTerms;
  contributions: SessionContribution[];
  protx: string;
  /** lower-case, "" until frozen */
  consentHash: string;
  collateralIndex: number;
  sigs: SessionSig[];
  prepareWallet: string;
  operatorSecretHolder: string;
  coordinatorLabel: string;
}

export interface FingerprintCheck {
  /** "XXXX-XXXX" the message carries, if any (a non-string is treated as absent, like Core) */
  stamped?: string;
  /** recomputed over the UniValue write(2) of the message without its fingerprint key */
  computed: string;
  /** "ok", "mismatch" (edited after copying: a warning in Core, not an error) or "absent" */
  status: "ok" | "mismatch" | "absent";
}

/** shared_mn::EnvelopeFingerprint: first 4 bytes of SHA256 over write(2) without "fingerprint", as XXXX-XXXX */
export function envelopeFingerprint(json: UniValue): string {
  const text = writeUniValue(withoutKey(json, "fingerprint"), 2);
  const hex = bytesToHex(sha256(text).subarray(0, 4)).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** shared_mn::CheckFingerprint */
export function checkFingerprint(json: UniValue): FingerprintCheck {
  const computed = envelopeFingerprint(json);
  const stamped = findValue(json, "fingerprint");
  if (!isStr(stamped)) return { computed, status: "absent" };
  return {
    stamped: stamped.value,
    computed,
    status: stamped.value.toUpperCase() === computed.toUpperCase() ? "ok" : "mismatch",
  };
}

/** QString::trimmed(): strips leading/trailing Unicode whitespace */
export function qtTrim(text: string): string {
  return text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
}

export type MessageKind = "session" | "sigs" | "standbyHex" | "unknown";

/** SharedMnImport::Detect (src/qt/sharedmnwidgets.cpp:355-401) */
export function detectMessage(text: string): { kind: MessageKind; error?: string } {
  const trimmed = qtTrim(text);
  if (!trimmed) return { kind: "unknown", error: "The clipboard does not contain a shared masternode message." };
  const json = readUniValue(trimmed);
  if (json?.type === "obj") {
    const type = findValue(json, "type");
    const t = isStr(type) ? type.value : "";
    if (t === SESSION_TYPE) return { kind: "session" };
    if (t === SIGS_TYPE) return { kind: "sigs" };
    return { kind: "unknown", error: "This message is not a shared masternode message." };
  }
  if (isHex(trimmed) && trimmed.length > 0) {
    try {
      const tx = decodeTx(trimmed);
      if (tx.type === TxType.ProDisTx) return { kind: "standbyHex" };
      return { kind: "unknown", error: "This transaction is not a shared masternode dissolution." };
    } catch {
      // fall through
    }
  }
  return { kind: "unknown", error: "The clipboard does not contain a shared masternode message." };
}

// ---------------------------------------------------------------------------------------------
// Session envelope

export type SessionErrorCode =
  | "too-large"
  | "not-json"
  | "not-session"
  | "version"
  | "network"
  | "session-id"
  | "revision"
  | "stage"
  | "too-many-shares"
  | "share-malformed"
  | "early-period"
  | "early-penalty"
  | "too-many-contributions"
  | "too-many-inputs"
  | "contribution-malformed"
  | "consent-hash-malformed"
  | "sig-malformed"
  | "sig-duplicate"
  | "missing-frozen"
  | "protx-not-hex"
  | "protx-not-shared"
  | "consent-mismatch"
  | "payload-mismatch"
  | "sig-out-of-range"
  | "combined-missing-sig"
  | "combined-invalid-sig"
  | "funding-unsigned"
  | "parse";

export interface SigStatus {
  shareIndex: number;
  label: string;
  /** a signature entry exists for this share */
  present: boolean;
  /** verified against the consent hash and this share's owner key (undefined when nothing to verify against) */
  valid?: boolean;
  reason?: string;
}

export interface RowStatus {
  index: number;
  label: string;
  amount: bigint;
  /** owner and refund address filled in (the participant has answered the invitation) */
  filled: boolean;
  /** addresses that do not decode for the envelope's network */
  badAddresses: Array<"owner" | "refund" | "reward">;
}

export interface FundingInputStatus {
  txid: string;
  vout: number;
  sequence: number;
  /** label of the contribution that lists this input, if any */
  contributor?: string;
  /** carries a scriptSig in the session's prepared transaction */
  signed: boolean;
}

export interface FrozenTx {
  tx: Tx;
  txid: string;
  payload: ProRegTxPayload;
  consentHash: Digest;
}

export interface SessionReport {
  /** whether Dash Core's MnShareSession::fromJson would accept the message */
  ok: boolean;
  errorCode?: SessionErrorCode;
  /** Core's error text for the first fatal problem */
  error?: string;
  envelope?: SessionEnvelope;
  stage?: Stage;
  stageName?: string;
  revision?: number;
  /** first 6 characters of the session id, upper-case ("Session XXXXXX" in Dash-Qt) */
  sessionCode?: string;
  fingerprint?: FingerprintCheck;
  rows: RowStatus[];
  sigs: SigStatus[];
  fundingInputs: FundingInputStatus[];
  /** the decoded prepared transaction (stage past draft) */
  frozen?: FrozenTx;
  /** recomputed consent hash equals the envelope's consentHash */
  consentHashOk?: boolean;
  /** payloadMatchesEnvelope result (stage past draft) */
  payloadMatches?: boolean;
  payloadMismatch?: string;
}

class SessionFail extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function str(v: UniValue | undefined): string | undefined {
  return isStr(v) ? v.value : undefined;
}

function int(v: UniValue | undefined, bits: 32 | 64, code: SessionErrorCode, msg: string): bigint {
  try {
    return getInt(v, bits);
  } catch {
    throw new SessionFail(code, msg);
  }
}

const TXID_RE = /^[0-9a-fA-F]{64}$/;

function readSession(json: UniValue, network: Network | undefined): SessionEnvelope {
  if (json.type !== "obj") throw new SessionFail("not-session", "The file is not a shared masternode session file.");
  if (str(findValue(json, "type")) !== SESSION_TYPE) {
    throw new SessionFail("not-session", "The file is not a shared masternode session file.");
  }
  const version = findValue(json, "version");
  const parseError = "The session file could not be parsed: JSON integer out of range";
  if (!isNum(version) || int(version, 32, "parse", parseError) !== 1n) {
    throw new SessionFail("version", "The session file uses an unsupported format version. Update Dash Core to open it.");
  }
  const net = str(findValue(json, "network"));
  if (net === undefined || (network ? net !== network : !isNetwork(net))) {
    throw new SessionFail(
      "network",
      `The session file is for the "${net ?? "unknown"}" network but this node runs "${network ?? "a known network"}". It cannot be used here.`,
    );
  }
  const sessionId = str(findValue(json, "sessionId"));
  if (!sessionId) throw new SessionFail("session-id", "The session file has no session id.");
  const revision = findValue(json, "revision");
  if (!isNum(revision) || int(revision, 32, "parse", parseError) < 1n) {
    throw new SessionFail("revision", "The session file has an invalid revision.");
  }
  const stageRaw = str(findValue(json, "stage"));
  if (stageRaw === undefined) throw new SessionFail("stage", "The session file has no stage.");
  if (!(STAGES as readonly string[]).includes(stageRaw)) {
    throw new SessionFail(
      "stage",
      `The session file is at the unknown stage "${stageRaw}". It was probably created by a newer Dash Core.`,
    );
  }

  const env: SessionEnvelope = {
    network: net,
    sessionId,
    revision: Number(getInt(revision, 32)),
    stage: stageRaw as Stage,
    fundingTx: str(findValue(json, "fundingTx")) ?? "",
    shares: [],
    terms: { coreP2PAddrs: "", operatorPubKey: "", votingAddress: "", operatorReward: 0, earlyPeriodBlocks: 0, earlyPenalty: 0n },
    contributions: [],
    protx: "",
    consentHash: "",
    collateralIndex: -1,
    sigs: [],
    prepareWallet: "",
    operatorSecretHolder: "",
    coordinatorLabel: "",
  };

  const shares = findValue(json, "shares");
  if (shares?.type === "arr") {
    if (shares.values.length > MAX_SHARES) {
      throw new SessionFail(
        "too-many-shares",
        `The session file lists ${shares.values.length} shares; a shared masternode can have at most ${MAX_SHARES}.`,
      );
    }
    shares.values.forEach((entry, i) => {
      const malformed = () => new SessionFail("share-malformed", `Share entry ${i + 1} in the session file is malformed.`);
      if (
        entry.type !== "obj" ||
        !isNum(findValue(entry, "amount")) ||
        !isStr(findValue(entry, "ownerAddress")) ||
        !isStr(findValue(entry, "refundAddress"))
      ) {
        throw malformed();
      }
      const amount = int(findValue(entry, "amount"), 64, "parse", parseError);
      if (!moneyRange(amount)) throw malformed();
      env.shares.push({
        label: str(findValue(entry, "label")) ?? "",
        amount,
        ownerAddress: str(findValue(entry, "ownerAddress"))!,
        refundAddress: str(findValue(entry, "refundAddress"))!,
        rewardAddress: str(findValue(entry, "rewardAddress")) ?? "",
      });
    });
  }

  const terms = findValue(json, "terms");
  if (terms?.type === "obj") {
    const t = env.terms;
    t.coreP2PAddrs = str(findValue(terms, "coreP2PAddrs")) ?? t.coreP2PAddrs;
    t.operatorPubKey = str(findValue(terms, "operatorPubKey")) ?? t.operatorPubKey;
    t.votingAddress = str(findValue(terms, "votingAddress")) ?? t.votingAddress;
    const reward = findValue(terms, "operatorReward");
    if (isNum(reward)) t.operatorReward = Number(int(reward, 32, "parse", parseError));
    const period = findValue(terms, "earlyPeriodBlocks");
    if (isNum(period)) {
      const blocks = int(period, 64, "parse", parseError);
      if (blocks < 0n || blocks > 0xffffffffn) throw new SessionFail("early-period", "The session file has an invalid early period.");
      t.earlyPeriodBlocks = Number(blocks);
    }
    const penalty = findValue(terms, "earlyPenalty");
    if (isNum(penalty)) {
      t.earlyPenalty = int(penalty, 64, "parse", parseError);
      if (!moneyRange(t.earlyPenalty)) {
        throw new SessionFail("early-penalty", "The session file has an invalid early-exit penalty.");
      }
    }
  }

  const contributions = findValue(json, "contributions");
  if (contributions?.type === "arr") {
    if (contributions.values.length > MAX_SHARES) {
      throw new SessionFail(
        "too-many-contributions",
        `The session file lists ${contributions.values.length} contributions; there can be at most one per share, and at most ${MAX_SHARES} shares.`,
      );
    }
    contributions.values.forEach((entry, i) => {
      const malformed = () =>
        new SessionFail("contribution-malformed", `Contribution entry ${i + 1} in the session file is malformed.`);
      const inputs = findValue(entry, "inputs");
      if (entry.type !== "obj" || !isStr(findValue(entry, "label")) || inputs?.type !== "arr") throw malformed();
      if (inputs.values.length > MAX_CONTRIBUTION_INPUTS) {
        throw new SessionFail(
          "too-many-inputs",
          `Contribution entry ${i + 1} in the session file has ${inputs.values.length} inputs; at most ${MAX_CONTRIBUTION_INPUTS} can be funded in one contribution.`,
        );
      }
      const c: SessionContribution = { label: str(findValue(entry, "label"))!, inputs: [], changeIndex: -1 };
      for (const input of inputs.values) {
        const txid = findValue(input, "txid");
        const vout = findValue(input, "vout");
        const seq = findValue(input, "sequence");
        if (input.type !== "obj" || !isStr(txid) || !isNum(vout) || !isNum(seq)) throw malformed();
        const v = int(vout, 64, "parse", parseError);
        const s = int(seq, 64, "parse", parseError);
        if (v < 0n || v > 0xffffffffn || s < 0n || s > 0xffffffffn) throw malformed();
        if (!TXID_RE.test(txid.value)) throw malformed();
        c.inputs.push({ txid: txid.value, vout: Number(v), sequence: Number(s) });
      }
      const change = findValue(entry, "change");
      if (change?.type === "obj") {
        const address = findValue(change, "address");
        const amount = findValue(change, "amount");
        if (!isStr(address) || !isNum(amount)) throw malformed();
        const a = int(amount, 64, "parse", parseError);
        if (!moneyRange(a)) throw malformed();
        c.change = { address: address.value, amount: a };
      }
      const ci = findValue(entry, "changeIndex");
      if (isNum(ci)) c.changeIndex = Number(int(ci, 32, "parse", parseError));
      env.contributions.push(c);
    });
  }

  env.protx = str(findValue(json, "protx")) ?? "";
  const consent = str(findValue(json, "consentHash"));
  if (consent !== undefined) {
    if (consent !== "" && !(consent.length === 64 && isHex(consent))) {
      throw new SessionFail("consent-hash-malformed", "The session file has a malformed consent hash.");
    }
    env.consentHash = consent.toLowerCase();
  }
  const coll = findValue(json, "collateralIndex");
  if (isNum(coll)) env.collateralIndex = Number(int(coll, 32, "parse", parseError));

  const sigs = findValue(json, "sigs");
  if (sigs?.type === "arr") {
    sigs.values.forEach((entry, i) => {
      const idx = findValue(entry, "shareIndex");
      const sig = findValue(entry, "signature");
      if (entry.type !== "obj" || !isNum(idx) || !isStr(sig)) {
        throw new SessionFail("sig-malformed", `Signature entry ${i + 1} in the session file is malformed.`);
      }
      const shareIndex = Number(int(idx, 32, "parse", parseError));
      if (env.sigs.some((s) => s.shareIndex === shareIndex)) {
        throw new SessionFail("sig-duplicate", `The session file lists more than one signature for share ${shareIndex + 1}.`);
      }
      env.sigs.push({ shareIndex, signature: sig.value });
    });
  }
  env.prepareWallet = str(findValue(json, "prepareWallet")) ?? "";
  env.operatorSecretHolder = str(findValue(json, "operatorSecretHolder")) ?? "";
  env.coordinatorLabel = str(findValue(json, "coordinatorLabel")) ?? "";
  return env;
}

/** DecodeSharedProTx + MakeSharedRegConsentHash: the envelope's protx hex as a shared ProRegTx */
export function decodeFrozenProTx(protxHex: string): FrozenTx | { error: SessionErrorCode; message: string } {
  let tx: Tx;
  try {
    if (!protxHex || !isHex(protxHex)) throw new Error();
    tx = decodeTx(protxHex);
  } catch {
    return { error: "protx-not-hex", message: "The session's prepared transaction is not valid transaction hex." };
  }
  let payload: ProRegTxPayload;
  try {
    if (tx.type !== TxType.ProRegTx) throw new Error();
    payload = decodeProRegTxPayload(tx.extraPayload);
    if (!isSharedPayload(payload)) throw new Error();
  } catch {
    return { error: "protx-not-shared", message: "The session's prepared transaction is not a shared masternode registration." };
  }
  return { tx, txid: txidOf(tx), payload, consentHash: sharedRegConsentHash(tx, payload) };
}

function scriptForAddress(address: string, network: Network): Bytes {
  // GetScriptForDestination(DecodeDestination(x)): an undecodable address yields an empty script
  return addressToScript(address, network) ?? new Uint8Array();
}

const FUNDING_MISMATCH =
  "The funding shown in the session file does not match its prepared transaction. Do not sign; request a fresh copy.";

/** MnShareSession::payloadMatchesEnvelope (src/qt/mnsharesession.cpp:976-1080); returns the error text or undefined */
export function payloadMismatch(env: SessionEnvelope, frozen: FrozenTx, network: Network): string | undefined {
  const { tx, payload } = frozen;
  if (payload.shares.length !== env.shares.length) {
    return "The session file's share table does not match its prepared transaction. Do not sign; request a fresh copy.";
  }
  for (let i = 0; i < env.shares.length; i++) {
    const share = env.shares[i]!;
    const signed = payload.shares[i]!;
    const owner = decodeAddress(share.ownerAddress, network);
    if (
      owner?.type !== "p2pkh" ||
      !equalBytes(owner.hash, signed.keyIDOwner) ||
      share.amount !== signed.amount ||
      !equalBytes(scriptForAddress(share.refundAddress, network), signed.scriptRefund)
    ) {
      return `Share ${i + 1} in the session file does not match its prepared transaction. Do not sign; request a fresh copy.`;
    }
    const expectedReward = share.rewardAddress === "" ? new Uint8Array() : scriptForAddress(share.rewardAddress, network);
    if (!equalBytes(expectedReward, signed.scriptReward)) {
      return `Share ${i + 1}'s reward address in the session file does not match its prepared transaction. Do not sign; request a fresh copy.`;
    }
  }
  const voting = decodeAddress(env.terms.votingAddress, network);
  if (
    voting?.type !== "p2pkh" ||
    !equalBytes(voting.hash, payload.keyIDVoting) ||
    bytesToHex(payload.pubKeyOperator) !== env.terms.operatorPubKey.toLowerCase() ||
    env.terms.operatorReward !== payload.operatorReward ||
    env.terms.earlyPeriodBlocks !== payload.earlyPeriodBlocks ||
    env.terms.earlyPenalty !== payload.earlyPenalty ||
    !netInfoMatchesServiceList(payload.netInfo, env.terms.coreP2PAddrs)
  ) {
    return "The terms shown in the session file do not match its prepared transaction. Do not sign; request a fresh copy.";
  }
  const expectedVin: SessionInput[] = env.contributions.flatMap((c) => c.inputs);
  const expectedVout: Array<{ value: bigint; script: Bytes }> = [];
  for (const c of env.contributions) {
    if (!c.change) continue;
    const script = addressToScript(c.change.address, network);
    if (!script) return FUNDING_MISMATCH;
    expectedVout.push({ value: c.change.amount, script });
  }
  if (
    env.collateralIndex < 0 ||
    env.collateralIndex !== expectedVout.length ||
    env.collateralIndex !== payload.collateralOutpoint.vout
  ) {
    return FUNDING_MISMATCH;
  }
  if (payload.mnType !== MnType.Regular) return FUNDING_MISMATCH;
  expectedVout.push({ value: REGULAR_COLLATERAL, script: SHARED_COLLATERAL_SCRIPT });
  if (tx.vin.length !== expectedVin.length || tx.vout.length !== expectedVout.length || tx.lockTime !== 0) {
    return FUNDING_MISMATCH;
  }
  for (let i = 0; i < expectedVin.length; i++) {
    const a = tx.vin[i]!;
    const e = expectedVin[i]!;
    if (a.prevout.txid !== e.txid.toLowerCase() || a.prevout.vout !== e.vout || a.sequence !== e.sequence) {
      return FUNDING_MISMATCH;
    }
  }
  for (let i = 0; i < expectedVout.length; i++) {
    if (tx.vout[i]!.value !== expectedVout[i]!.value || !equalBytes(tx.vout[i]!.script, expectedVout[i]!.script)) {
      return FUNDING_MISMATCH;
    }
  }
  return undefined;
}

function shareName(env: SessionEnvelope, i: number): string {
  return env.shares[i]?.label || `Share ${i + 1}`;
}

function verifySessionSig(env: SessionEnvelope, frozen: FrozenTx, sig: SessionSig): { valid: boolean; reason?: string } {
  const share = frozen.payload.shares[sig.shareIndex];
  if (!share) return { valid: false, reason: `Share ${sig.shareIndex + 1} of ${frozen.payload.shares.length} does not exist.` };
  const bytes = decodeBase64Core(sig.signature);
  if (!bytes) return { valid: false, reason: "The signature is not valid base64." };
  const check = verifyCompactCanonical(frozen.consentHash.bytes, share.keyIDOwner, bytes);
  if (!check.ok) {
    const label = shareName(env, sig.shareIndex);
    return {
      valid: false,
      reason: `The signature from ${label} does not verify against the current terms. It was most likely made for an older version of this session — ask ${label} to re-sign the current version.`,
    };
  }
  return { valid: true };
}

export interface ParseOptions {
  /** the network the reader's node runs; when omitted the envelope's own (known) network is used */
  network?: Network;
}

/**
 * Parse and validate a `dash-shared-mn-session` v1 message the way Dash-Qt's
 * MnShareSession::fromJson does (src/qt/mnsharesession.cpp:361-664), and report what a
 * participant needs to see: stage, revision, session code, which rows are filled, which consent
 * signatures are present and valid, which funding inputs are signed, and the fingerprint.
 * Diagnostics are filled in as far as parsing got, even when `ok` is false.
 */
export function parseSessionEnvelope(text: string, opts: ParseOptions = {}): SessionReport {
  const report: SessionReport = { ok: false, rows: [], sigs: [], fundingInputs: [] };
  const fail = (code: SessionErrorCode, error: string): SessionReport => Object.assign(report, { ok: false, errorCode: code, error });

  if (utf8(text).length > MAX_ENVELOPE_BYTES) return fail("too-large", "That message is too large to be a shared masternode message.");
  const json = readUniValue(qtTrim(text));
  if (!json) return fail("not-json", "The file is not valid JSON.");

  let env: SessionEnvelope;
  try {
    env = readSession(json, opts.network);
  } catch (e) {
    if (e instanceof SessionFail) return fail(e.code, e.message);
    throw e;
  }
  const network = (opts.network ?? env.network) as Network;
  report.envelope = env;
  report.stage = env.stage;
  report.stageName = STAGE_NAMES[env.stage];
  report.revision = env.revision;
  report.sessionCode = env.sessionId.slice(0, 6).toUpperCase();
  report.fingerprint = checkFingerprint(json);
  report.rows = env.shares.map((s, index) => {
    const bad: RowStatus["badAddresses"] = [];
    if (s.ownerAddress && decodeAddress(s.ownerAddress, network)?.type !== "p2pkh") bad.push("owner");
    if (s.refundAddress && !decodeAddress(s.refundAddress, network)) bad.push("refund");
    if (s.rewardAddress && !decodeAddress(s.rewardAddress, network)) bad.push("reward");
    return { index, label: s.label, amount: s.amount, filled: s.ownerAddress !== "" && s.refundAddress !== "", badAddresses: bad };
  });
  report.sigs = env.shares.map((_, i) => ({ shareIndex: i, label: shareName(env, i), present: env.sigs.some((s) => s.shareIndex === i) }));
  report.fundingInputs = env.contributions.flatMap((c) =>
    c.inputs.map((i) => ({ txid: i.txid, vout: i.vout, sequence: i.sequence, contributor: c.label, signed: false })),
  );

  if (env.stage === "draft") {
    report.ok = true;
    return report;
  }
  if (!env.protx || !env.consentHash) {
    return fail("missing-frozen", `The session file is marked "${STAGE_NAMES[env.stage]}" but is missing its frozen transaction or consent hash.`);
  }
  const frozen = decodeFrozenProTx(env.protx);
  if ("error" in frozen) return fail(frozen.error, frozen.message);
  report.frozen = frozen;
  report.fundingInputs = frozen.tx.vin.map((i) => ({
    txid: i.prevout.txid,
    vout: i.prevout.vout,
    sequence: i.sequence,
    ...(contributorOf(env, i.prevout.txid, i.prevout.vout) !== undefined
      ? { contributor: contributorOf(env, i.prevout.txid, i.prevout.vout)! }
      : {}),
    signed: i.scriptSig.length > 0,
  }));
  report.consentHashOk = frozen.consentHash.hex === env.consentHash;
  // Verify every present signature for display, whatever the stage
  for (const sig of env.sigs) {
    const row = report.sigs[sig.shareIndex];
    if (!row) continue;
    const v = report.consentHashOk ? verifySessionSig(env, frozen, sig) : { valid: false, reason: "The consent hash does not match." };
    row.valid = v.valid;
    if (v.reason) row.reason = v.reason;
  }
  const mismatch = payloadMismatch(env, frozen, network);
  report.payloadMatches = mismatch === undefined;
  if (mismatch) report.payloadMismatch = mismatch;

  if (!report.consentHashOk) {
    return fail(
      "consent-mismatch",
      "The prepared transaction does not match the terms everyone approved. Do not sign or broadcast it; request a fresh copy.",
    );
  }
  if (mismatch) return fail("payload-mismatch", mismatch);
  if (env.sigs.some((s) => s.shareIndex < 0 || s.shareIndex >= env.shares.length)) {
    return fail("sig-out-of-range", "The session file has a signature for a share that does not exist.");
  }
  const atLeast = (s: Stage) => stageIndex(env.stage) >= stageIndex(s);
  if (atLeast("combined") && env.sigs.length !== env.shares.length) {
    return fail("combined-missing-sig", "The session file claims the approvals are combined, but not every share has an approval.");
  }
  if (atLeast("combined")) {
    for (const sig of env.sigs) {
      const v = verifySessionSig(env, frozen, sig);
      if (!v.valid) {
        return fail("combined-invalid-sig", `The session file claims the approvals are combined, but an approval is invalid: ${v.reason}`);
      }
    }
  }
  if (atLeast("fundingSigned") && frozen.tx.vin.some((i) => i.scriptSig.length === 0)) {
    return fail(
      "funding-unsigned",
      "The session file claims every contribution is signed, but one or more funding inputs are unsigned.",
    );
  }
  report.ok = true;
  return report;
}

function contributorOf(env: SessionEnvelope, txid: string, vout: number): string | undefined {
  return env.contributions.find((c) => c.inputs.some((i) => i.txid.toLowerCase() === txid && i.vout === vout))?.label;
}

// ---------------------------------------------------------------------------------------------
// Dissolutions

/** On-chain share data (from `protx info` or the decoded registration) needed to judge dissolutions */
export interface ChainShare {
  amount: bigint;
  scriptRefund: Bytes;
  keyIDOwner: Bytes;
}

export interface DissolutionReading {
  /** pays every share its full principal, fee from the actor's share (Core's ReturnsPrincipal template) */
  returnsPrincipal: boolean;
  error?: string;
  /** principal total minus outputs */
  fee: bigint;
  /** what each share receives, by share index (actor: its output or 0) */
  payouts: bigint[];
  /** amount above principal each non-actor share receives (the early-exit penalty bonus) */
  bonuses: bigint[];
  /** every output pays the right refund script in share order (the consensus layout) */
  layoutOk: boolean;
}

/**
 * Read a ProDisTx against the share table: the consensus layout (one output per non-actor share
 * in share order to its refund script, optional final actor output) and whether it is the
 * principal-returning template SharedMnReadDissolution accepts (src/qt/sharedmnwidgets.cpp).
 */
export function readDissolution(tx: Tx, actorIndex: number, shares: readonly ChainShare[]): DissolutionReading {
  const res: DissolutionReading = { returnsPrincipal: false, fee: 0n, payouts: [], bonuses: [], layoutOk: false };
  if (shares.length === 0 || actorIndex >= shares.length) {
    res.error = "This request names a share this masternode does not have.";
    return res;
  }
  if (tx.vin.length !== 1) {
    res.error = "This request does not spend exactly the masternode's collateral. Do not approve it.";
    return res;
  }
  const principal = shares.reduce((a, s) => a + s.amount, 0n);
  const outTotal = tx.vout.reduce((a, o) => a + o.value, 0n);
  res.fee = principal - outTotal;
  res.payouts = shares.map(() => 0n);
  res.bonuses = shares.map(() => 0n);
  let out = 0;
  let layout = tx.vout.length === shares.length - 1 || tx.vout.length === shares.length;
  for (let i = 0; i < shares.length; i++) {
    if (i === actorIndex) continue;
    const o = tx.vout[out++];
    if (!o || !equalBytes(o.script, shares[i]!.scriptRefund)) {
      layout = false;
      continue;
    }
    res.payouts[i] = o.value;
    res.bonuses[i] = o.value - shares[i]!.amount;
  }
  const actorOut = tx.vout[shares.length - 1];
  if (actorOut) {
    if (!equalBytes(actorOut.script, shares[actorIndex]!.scriptRefund) || actorOut.value === 0n) layout = false;
    else res.payouts[actorIndex] = actorOut.value;
  }
  res.layoutOk = layout;
  const refuse =
    "This request does not pay every share its full principal. Do not approve it; ask whoever prepared it for a fresh request.";
  if (!layout || shares.some((s, i) => i !== actorIndex && res.bonuses[i] !== 0n)) {
    res.error = refuse;
    return res;
  }
  if (res.fee <= 0n) {
    res.error = refuse;
    return res;
  }
  if (res.fee > 1_000_000n) {
    res.error = "This request keeps more than 0.01 DASH of the shares' principal as a transaction fee. Do not approve it.";
    return res;
  }
  res.returnsPrincipal = true;
  return res;
}

export interface ProDisReport {
  txid: string;
  proTxHash: string;
  actorIndex: number;
  /** "unilateral" (1 signature), "unanimous" (N signatures), or "unsigned" (a request) */
  mode: "unilateral" | "unanimous" | "unsigned";
  payload: ProDisTxPayload;
  tx: Tx;
  /** present when the share table is known */
  reading?: DissolutionReading;
  /** per signature validity (when the share table is known) */
  sigs?: Array<{ index: number; valid: boolean; reason?: string }>;
}

/** Decode and, when `shares` is given, check a ProDisTx (bare hex or a standby line) */
export function inspectProDisTx(hex: string, shares?: readonly ChainShare[]): ProDisReport {
  const tx = decodeTx(hex.trim());
  if (tx.type !== TxType.ProDisTx) throw new Error("not a ProDisTx (type 10)");
  const payload = decodeProDisTxPayload(tx.extraPayload);
  const n = payload.sigs.length;
  const mode = n === 0 ? "unsigned" : n === 1 ? "unilateral" : "unanimous";
  const rep: ProDisReport = { txid: txidOf(tx), proTxHash: payload.proTxHash, actorIndex: payload.actorIndex, mode, payload, tx };
  if (shares) {
    rep.reading = readDissolution(tx, payload.actorIndex, shares);
    if (n > 0) {
      const h = proDisSignHash(tx, payload, n);
      rep.sigs = payload.sigs.map((sig, i) => {
        const owner = n === 1 ? shares[payload.actorIndex] : shares[i];
        if (!owner) return { index: i, valid: false, reason: "no such share" };
        const c = verifyCompactCanonical(h.bytes, owner.keyIDOwner, sig);
        return c.ok ? { index: i, valid: true } : { index: i, valid: false, reason: c.reason! };
      });
    }
  }
  return rep;
}

export interface StandbyFile {
  proTxHash?: string;
  /** the "FULL PRINCIPAL" line's transaction (valid after the early period) */
  full?: ProDisReport;
  /** the "IMMEDIATE" line's transaction (pays the early-exit penalty, valid now) */
  immediate?: ProDisReport;
  /** every ProDisTx found, in file order */
  transactions: ProDisReport[];
  /** stated "valid from block H", when present */
  validFromHeight?: number;
}

/**
 * Parse a standby-dissolution text file as DissolveDialog::standbyFileText writes it
 * (src/qt/sharedmndialogs.cpp:1720-1753). Header wording may be translated, so transactions are
 * found as hex lines; the English headers, when present, label them, otherwise file order is
 * used (full principal first, then immediate).
 */
export function parseStandbyFile(text: string, shares?: readonly ChainShare[]): StandbyFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const res: StandbyFile = { transactions: [] };
  const mn = lines.map((l) => /^Masternode:\s*([0-9a-fA-F]{64})$/.exec(l)).find((m) => m);
  if (mn) res.proTxHash = mn[1]!.toLowerCase();
  let label: "full" | "immediate" | undefined;
  for (const line of lines) {
    const valid = /^FULL PRINCIPAL\b.*?valid from block (\d+)/.exec(line);
    if (valid) res.validFromHeight = Number(valid[1]);
    if (line.startsWith("FULL PRINCIPAL")) label = "full";
    else if (line.startsWith("IMMEDIATE")) label = "immediate";
    if (line.length < 20 || !isHex(line)) continue;
    let rep: ProDisReport;
    try {
      rep = inspectProDisTx(line, shares);
    } catch {
      continue;
    }
    res.transactions.push(rep);
    const slot = label ?? (res.transactions.length === 1 ? "full" : "immediate");
    if (!res[slot]) res[slot] = rep;
    label = undefined;
  }
  if (!res.proTxHash && res.transactions[0]) res.proTxHash = res.transactions[0].proTxHash;
  return res;
}

// ---------------------------------------------------------------------------------------------
// dash-shared-mn-sigs envelope

export interface SigsReport {
  ok: boolean;
  error?: string;
  kind?: "dissolve" | "registrar" | string;
  network?: string;
  proTxHash?: string;
  txHex?: string;
  fingerprint?: FingerprintCheck;
  /** the digest every share owner signs (unanimous), when computable */
  signHash?: Digest;
  dissolution?: ProDisReport;
  registrar?: ProUpSharedRegTxPayload;
  signatures: Array<{ shareIndex: number; signature: string; valid?: boolean; reason?: string }>;
}

/**
 * Parse a `dash-shared-mn-sigs` v1 message (SharedSigCollector::importEnvelopeChecked,
 * src/qt/sharedmndialogs.cpp:688-730). With the masternode's `shares` the sign hash and every
 * approval are verified as ComputeSharedSignHash / addSignatures do.
 */
export function parseSigsEnvelope(
  text: string,
  opts: { network?: Network; proTxHash?: string; shares?: readonly ChainShare[] } = {},
): SigsReport {
  const rep: SigsReport = { ok: false, signatures: [] };
  if (utf8(text).length > MAX_ENVELOPE_BYTES) return { ...rep, error: "That message is too large to be a shared masternode message." };
  const json = readUniValue(qtTrim(text));
  const notOurs = "This is not a shared masternode message.";
  if (!json || json.type !== "obj" || str(findValue(json, "type")) !== SIGS_TYPE) return { ...rep, error: notOurs };
  rep.fingerprint = checkFingerprint(json);
  const network = str(findValue(json, "network"));
  const kind = str(findValue(json, "kind"));
  const proTxHash = str(findValue(json, "proTxHash"));
  const txHex = str(findValue(json, "tx"));
  if (network !== undefined) rep.network = network;
  if (kind !== undefined) rep.kind = kind;
  if (proTxHash !== undefined) rep.proTxHash = proTxHash.toLowerCase();
  if (txHex !== undefined) rep.txHex = txHex;
  const sigs = findValue(json, "signatures");
  if (sigs?.type === "arr") {
    for (const e of sigs.values) {
      const idx = findValue(e, "shareIndex");
      const sig = findValue(e, "signature");
      let shareIndex = -1;
      try {
        shareIndex = Number(getInt(idx, 32));
      } catch {
        // unreadable index stays -1
      }
      rep.signatures.push({ shareIndex, signature: isStr(sig) ? sig.value : "" });
    }
  }
  if ((opts.network ? network !== opts.network : !isNetwork(network))) {
    return { ...rep, error: `This message is for the ${network ?? ""} network; this wallet runs on ${opts.network ?? "a known network"}.` };
  }
  if (kind !== "dissolve" && kind !== "registrar") {
    return { ...rep, error: "This message is about a different kind of change to this masternode." };
  }
  if (!proTxHash || (opts.proTxHash && proTxHash.toLowerCase() !== opts.proTxHash.toLowerCase())) {
    return { ...rep, error: "This message is about a different masternode." };
  }
  if (txHex) {
    let tx: Tx;
    try {
      tx = decodeTx(txHex.trim());
    } catch {
      return { ...rep, error: "The transaction is not valid transaction hex." };
    }
    if (kind === "dissolve") {
      if (tx.type !== TxType.ProDisTx) return { ...rep, error: "The transaction is not a dissolution transaction." };
      const d = inspectProDisTx(txHex, opts.shares);
      rep.dissolution = d;
      if (d.proTxHash !== proTxHash.toLowerCase()) return { ...rep, error: "The transaction dissolves a different masternode." };
      if (d.payload.sigs.length) {
        return { ...rep, error: "The transaction already carries signatures; expected the unsigned prepared transaction." };
      }
      if (opts.shares) {
        if (!d.reading?.returnsPrincipal) return { ...rep, error: d.reading?.error ?? "invalid dissolution" };
        rep.signHash = proDisSignHash(tx, d.payload, opts.shares.length);
      }
    } else {
      if (tx.type !== TxType.ProUpSharedRegTx) return { ...rep, error: "The transaction is not a shared registrar update." };
      let p: ProUpSharedRegTxPayload;
      try {
        p = decodeProUpSharedRegTxPayload(tx.extraPayload);
      } catch {
        return { ...rep, error: "The transaction payload is not deserializable." };
      }
      rep.registrar = p;
      if (p.proTxHash !== proTxHash.toLowerCase()) return { ...rep, error: "The transaction updates a different masternode." };
      rep.signHash = proUpSharedRegSignHash(p);
    }
  }
  if (rep.signHash && opts.shares) {
    for (const s of rep.signatures) {
      const share = opts.shares[s.shareIndex];
      const bytes = decodeBase64Core(s.signature);
      if (!share) Object.assign(s, { valid: false, reason: `Share number ${s.shareIndex + 1} is out of range.` });
      else if (!bytes || bytes.length !== 65) Object.assign(s, { valid: false, reason: "not a base64 65-byte compact signature" });
      else {
        const c = verifyCompactCanonical(rep.signHash.bytes, share.keyIDOwner, bytes);
        Object.assign(s, c.ok ? { valid: true } : { valid: false, reason: "does not match the prepared transaction" });
      }
    }
  }
  rep.ok = true;
  return rep;
}
