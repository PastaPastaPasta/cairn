import { type Bytes, DecodeError, Reader, Writer, bytesToHex, equalBytes, uint256FromHex, uint256ToHex } from "./bytes.ts";
import { type NetInfo, readNetInfo, writeNetInfo } from "./netinfo.ts";
import { type OutPoint, type Tx, TxType, decodeTx, readOutPoint, txid, writeOutPoint } from "./tx.ts";

/** ProTxVersion (src/evo/types.h) */
export const ProTxVersion = { LegacyBLS: 1, BasicBLS: 2, ExtAddr: 3 } as const;
/** MnType (src/evo/dmn_types.h) */
export const MnType = { Regular: 0, Evo: 1 } as const;

/** SharedCollateralScript(): 0x04 "DSHC" OP_DROP OP_TRUE (src/evo/sharedcollateral.h) */
export const SHARED_COLLATERAL_SCRIPT = Uint8Array.of(0x04, 0x44, 0x53, 0x48, 0x43, 0x75, 0x51);
export const SHARED_COLLATERAL_SCRIPT_HEX = bytesToHex(SHARED_COLLATERAL_SCRIPT);

export function isSharedCollateralScript(script: Bytes): boolean {
  return equalBytes(script, SHARED_COLLATERAL_SCRIPT);
}

const NULL_HASH = "0".repeat(64);
const COMPACT_SIG_SIZE = 65;

export interface PayoutShare {
  script: Bytes;
  /** basis points */
  reward: number;
}

/** CCollateralShare (src/evo/providertx.h) */
export interface CollateralShare {
  amount: bigint;
  scriptRefund: Bytes;
  /** empty = rewards go to scriptRefund */
  scriptReward: Bytes;
  /** 20-byte owner key ID */
  keyIDOwner: Bytes;
}

/** CProRegTx payload (src/evo/providertx.h:150-235) */
export interface ProRegTxPayload {
  version: number;
  mnType: number;
  mode: number;
  collateralOutpoint: OutPoint;
  netInfo: NetInfo;
  keyIDOwner: Bytes;
  /** 48-byte BLS public key, as serialized for this payload version */
  pubKeyOperator: Bytes;
  keyIDVoting: Bytes;
  operatorReward: number;
  /** v1-v2 only */
  scriptPayout: Bytes;
  /** v3+ DIP-0026 payouts */
  payouts: PayoutShare[];
  /** v3+ shared share table; non-empty = shared registration */
  shares: CollateralShare[];
  /** v3+ one 65-byte compact signature per share */
  joinSigs: Bytes[];
  earlyPeriodBlocks: number;
  earlyPenalty: bigint;
  inputsHash: Bytes;
  /** Evo only */
  platformNodeID: Bytes;
  platformP2PPort: number;
  platformHTTPPort: number;
  vchSig: Bytes;
}

export function isSharedPayload(p: ProRegTxPayload): boolean {
  return p.shares.length > 0;
}

export function decodeProRegTxPayload(payload: Bytes): ProRegTxPayload {
  const r = new Reader(payload);
  const version = r.u16();
  if (version === 0 || version > ProTxVersion.ExtAddr) throw new DecodeError(`unknown ProRegTx version ${version}`);
  const ext = version >= ProTxVersion.ExtAddr;
  const mnType = r.u16();
  const mode = r.u16();
  const collateralOutpoint = readOutPoint(r);
  const netInfo = readNetInfo(r, ext);
  const keyIDOwner = r.bytes(20);
  const pubKeyOperator = r.bytes(48);
  const keyIDVoting = r.bytes(20);
  const operatorReward = r.u16();
  let scriptPayout: Bytes = new Uint8Array();
  const payouts: PayoutShare[] = [];
  const shares: CollateralShare[] = [];
  const joinSigs: Bytes[] = [];
  let earlyPeriodBlocks = 0;
  let earlyPenalty = 0n;
  if (ext) {
    const nPayouts = r.u8();
    for (let i = 0; i < nPayouts; i++) {
      const script = r.varBytes();
      payouts.push({ script, reward: r.u16() });
    }
    const nShares = r.u8();
    for (let i = 0; i < nShares; i++) {
      const amount = r.i64();
      const scriptRefund = r.varBytes();
      const scriptReward = r.varBytes();
      shares.push({ amount, scriptRefund, scriptReward, keyIDOwner: r.bytes(20) });
    }
    for (let i = 0; i < nShares; i++) joinSigs.push(r.bytes(COMPACT_SIG_SIZE));
    earlyPeriodBlocks = r.u32();
    earlyPenalty = r.i64();
  } else {
    scriptPayout = r.varBytes();
  }
  const inputsHash = r.bytes(32);
  let platformNodeID: Bytes = new Uint8Array(20);
  let platformP2PPort = 0;
  let platformHTTPPort = 0;
  if (mnType === MnType.Evo) {
    platformNodeID = r.bytes(20);
    if (!ext) {
      platformP2PPort = r.u16();
      platformHTTPPort = r.u16();
    }
  }
  const vchSig = r.varBytes();
  r.end("ProRegTx payload");
  return {
    version,
    mnType,
    mode,
    collateralOutpoint,
    netInfo,
    keyIDOwner,
    pubKeyOperator,
    keyIDVoting,
    operatorReward,
    scriptPayout,
    payouts,
    shares,
    joinSigs,
    earlyPeriodBlocks,
    earlyPenalty,
    inputsHash,
    platformNodeID,
    platformP2PPort,
    platformHTTPPort,
    vchSig,
  };
}

export function writeCollateralShare(w: Writer, s: CollateralShare): void {
  w.i64(s.amount).varBytes(s.scriptRefund).varBytes(s.scriptReward).bytes(s.keyIDOwner);
}

export function encodeProRegTxPayload(p: ProRegTxPayload): Bytes {
  const ext = p.version >= ProTxVersion.ExtAddr;
  if (ext && p.joinSigs.length !== p.shares.length) throw new Error("join signature count mismatch");
  const w = new Writer();
  w.u16(p.version).u16(p.mnType).u16(p.mode);
  writeOutPoint(w, p.collateralOutpoint);
  writeNetInfo(w, p.netInfo);
  w.bytes(p.keyIDOwner).bytes(p.pubKeyOperator).bytes(p.keyIDVoting).u16(p.operatorReward);
  if (ext) {
    w.u8(p.payouts.length);
    for (const po of p.payouts) w.varBytes(po.script).u16(po.reward);
    w.u8(p.shares.length);
    for (const s of p.shares) writeCollateralShare(w, s);
    for (const sig of p.joinSigs) {
      if (sig.length !== COMPACT_SIG_SIZE) throw new Error("join signature must be 65 bytes");
      w.bytes(sig);
    }
    w.u32(p.earlyPeriodBlocks).i64(p.earlyPenalty);
  } else {
    w.varBytes(p.scriptPayout);
  }
  w.bytes(p.inputsHash);
  if (p.mnType === MnType.Evo) {
    w.bytes(p.platformNodeID);
    if (!ext) w.u16(p.platformP2PPort).u16(p.platformHTTPPort);
  }
  w.varBytes(p.vchSig);
  return w.finish();
}

/** CProDisTx (type 10) */
export interface ProDisTxPayload {
  version: number;
  proTxHash: string;
  actorIndex: number;
  sigs: Bytes[];
}

export function decodeProDisTxPayload(payload: Bytes): ProDisTxPayload {
  const r = new Reader(payload);
  const version = r.u16();
  const proTxHash = uint256ToHex(r.bytes(32));
  const actorIndex = r.u16();
  const n = r.u8();
  const sigs: Bytes[] = [];
  for (let i = 0; i < n; i++) sigs.push(r.bytes(COMPACT_SIG_SIZE));
  r.end("ProDisTx payload");
  return { version, proTxHash, actorIndex, sigs };
}

export function encodeProDisTxPayload(p: ProDisTxPayload): Bytes {
  const w = new Writer().u16(p.version).bytes(uint256FromHex(p.proTxHash)).u16(p.actorIndex).u8(p.sigs.length);
  for (const s of p.sigs) w.bytes(s);
  return w.finish();
}

/** CProUpShareTx (type 11) */
export interface ProUpShareTxPayload {
  version: number;
  proTxHash: string;
  shareIndex: number;
  scriptReward: Bytes;
  inputsHash: Bytes;
  vchSig: Bytes;
}

export function decodeProUpShareTxPayload(payload: Bytes): ProUpShareTxPayload {
  const r = new Reader(payload);
  const version = r.u16();
  const proTxHash = uint256ToHex(r.bytes(32));
  const shareIndex = r.u16();
  const scriptReward = r.varBytes();
  const inputsHash = r.bytes(32);
  const vchSig = r.varBytes();
  r.end("ProUpShareTx payload");
  return { version, proTxHash, shareIndex, scriptReward, inputsHash, vchSig };
}

/** SER_GETHASH form (no vchSig) when `forHash` */
export function encodeProUpShareTxPayload(p: ProUpShareTxPayload, forHash = false): Bytes {
  const w = new Writer()
    .u16(p.version)
    .bytes(uint256FromHex(p.proTxHash))
    .u16(p.shareIndex)
    .varBytes(p.scriptReward)
    .bytes(p.inputsHash);
  if (!forHash) w.varBytes(p.vchSig);
  return w.finish();
}

/** CProUpSharedRegTx (type 12) */
export interface ProUpSharedRegTxPayload {
  version: number;
  proTxHash: string;
  pubKeyOperator: Bytes;
  keyIDVoting: Bytes;
  inputsHash: Bytes;
  sigs: Bytes[];
}

export function decodeProUpSharedRegTxPayload(payload: Bytes): ProUpSharedRegTxPayload {
  const r = new Reader(payload);
  const version = r.u16();
  const proTxHash = uint256ToHex(r.bytes(32));
  const pubKeyOperator = r.bytes(48);
  const keyIDVoting = r.bytes(20);
  const inputsHash = r.bytes(32);
  const n = r.u8();
  const sigs: Bytes[] = [];
  for (let i = 0; i < n; i++) sigs.push(r.bytes(COMPACT_SIG_SIZE));
  r.end("ProUpSharedRegTx payload");
  return { version, proTxHash, pubKeyOperator, keyIDVoting, inputsHash, sigs };
}

export function encodeProUpSharedRegTxPayload(p: ProUpSharedRegTxPayload, forHash = false): Bytes {
  const w = new Writer()
    .u16(p.version)
    .bytes(uint256FromHex(p.proTxHash))
    .bytes(p.pubKeyOperator)
    .bytes(p.keyIDVoting)
    .bytes(p.inputsHash);
  if (!forHash) {
    w.u8(p.sigs.length);
    for (const s of p.sigs) w.bytes(s);
  }
  return w.finish();
}

export interface DecodedProRegTx {
  tx: Tx;
  txid: string;
  payload: ProRegTxPayload;
}

export interface DecodedSharedProRegTx extends DecodedProRegTx {
  /** index of the 1000 DASH template output named by collateralOutpoint.n */
  collateralIndex: number;
}

export function decodeProRegTx(hexOrTx: string | Bytes | Tx): DecodedProRegTx {
  const tx = typeof hexOrTx === "string" || hexOrTx instanceof Uint8Array ? decodeTx(hexOrTx) : hexOrTx;
  if (tx.type !== TxType.ProRegTx) throw new DecodeError("not a ProRegTx (type 1)");
  return { tx, txid: txid(tx), payload: decodeProRegTxPayload(tx.extraPayload) };
}

/**
 * Decode a shared ProRegTx, as the Qt wizard's DecodeSharedProTx does: the payload must
 * deserialize completely and carry a share table. The collateral must be internal and its
 * output must be the shared collateral template.
 */
export function decodeSharedProRegTx(hexOrTx: string | Bytes | Tx): DecodedSharedProRegTx {
  const d = decodeProRegTx(hexOrTx);
  if (!isSharedPayload(d.payload)) throw new DecodeError("not a shared masternode registration");
  if (d.payload.collateralOutpoint.txid !== NULL_HASH) throw new DecodeError("shared collateral must be internal");
  const idx = d.payload.collateralOutpoint.vout;
  const out = d.tx.vout[idx];
  if (!out || !isSharedCollateralScript(out.script)) {
    throw new DecodeError("collateral output is not the shared collateral template");
  }
  return { ...d, collateralIndex: idx };
}

export type SpecialTxInfo =
  | { kind: "proRegTx"; txid: string; shared: boolean; payload: ProRegTxPayload }
  | { kind: "proDisTx"; txid: string; proTxHash: string; payload: ProDisTxPayload }
  | { kind: "proUpShareTx"; txid: string; proTxHash: string; payload: ProUpShareTxPayload }
  | { kind: "proUpSharedRegTx"; txid: string; proTxHash: string; payload: ProUpSharedRegTxPayload }
  | { kind: "other"; txid: string; type: number };

/** Identify a shared-masternode lifecycle transaction and its proTxHash. Throws DecodeError on malformed payloads. */
export function identifySpecialTx(hexOrTx: string | Bytes | Tx): SpecialTxInfo & { tx: Tx } {
  const tx = typeof hexOrTx === "string" || hexOrTx instanceof Uint8Array ? decodeTx(hexOrTx) : hexOrTx;
  const id = txid(tx);
  switch (tx.type) {
    case TxType.ProRegTx: {
      const payload = decodeProRegTxPayload(tx.extraPayload);
      return { kind: "proRegTx", txid: id, shared: isSharedPayload(payload), payload, tx };
    }
    case TxType.ProDisTx: {
      const payload = decodeProDisTxPayload(tx.extraPayload);
      return { kind: "proDisTx", txid: id, proTxHash: payload.proTxHash, payload, tx };
    }
    case TxType.ProUpShareTx: {
      const payload = decodeProUpShareTxPayload(tx.extraPayload);
      return { kind: "proUpShareTx", txid: id, proTxHash: payload.proTxHash, payload, tx };
    }
    case TxType.ProUpSharedRegTx: {
      const payload = decodeProUpSharedRegTxPayload(tx.extraPayload);
      return { kind: "proUpSharedRegTx", txid: id, proTxHash: payload.proTxHash, payload, tx };
    }
    default:
      return { kind: "other", txid: id, type: tx.type, tx };
  }
}

export function operatorPubKeyHex(p: { pubKeyOperator: Bytes }): string {
  return bytesToHex(p.pubKeyOperator);
}

export function withPayload(tx: Tx, payload: Bytes): Tx {
  return { ...tx, extraPayload: payload };
}

