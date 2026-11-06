import {
  type Bytes,
  DecodeError,
  Reader,
  Writer,
  bytesToHex,
  hexToBytes,
  sha256d,
  uint256FromHex,
  uint256ToHex,
} from "./bytes.ts";

/** Special transaction types (src/primitives/transaction.h TxType) */
export const TxType = {
  Normal: 0,
  ProRegTx: 1,
  ProUpServTx: 2,
  ProUpRegTx: 3,
  ProUpRevTx: 4,
  Coinbase: 5,
  QuorumCommitment: 6,
  MnhfSignal: 7,
  AssetLock: 8,
  AssetUnlock: 9,
  ProDisTx: 10,
  ProUpShareTx: 11,
  ProUpSharedRegTx: 12,
} as const;

/** CTransaction::SPECIAL_VERSION */
export const SPECIAL_VERSION = 3;

export interface OutPoint {
  /** Displayed txid hex (reversed byte order, as Core prints it) */
  txid: string;
  vout: number;
}

export interface TxIn {
  prevout: OutPoint;
  scriptSig: Bytes;
  sequence: number;
}

export interface TxOut {
  value: bigint;
  script: Bytes;
}

export interface Tx {
  /** int16 nVersion */
  version: number;
  /** uint16 nType */
  type: number;
  vin: TxIn[];
  vout: TxOut[];
  lockTime: number;
  /** vExtraPayload, present iff version >= 3 and type != 0 */
  extraPayload: Bytes;
}

export function readOutPoint(r: Reader): OutPoint {
  const hash = r.bytes(32);
  return { txid: uint256ToHex(hash), vout: r.u32() };
}

export function writeOutPoint(w: Writer, o: OutPoint): void {
  w.bytes(uint256FromHex(o.txid)).u32(o.vout);
}

export function writeTxOut(w: Writer, o: TxOut): void {
  w.i64(o.value).varBytes(o.script);
}

export function hasExtraPayload(version: number, type: number): boolean {
  return version >= SPECIAL_VERSION && type !== TxType.Normal;
}

/** Deserialize a Dash transaction (CMutableTransaction::SERIALIZE_METHODS); the whole buffer must be consumed. */
export function decodeTx(input: string | Bytes): Tx {
  const bytes = typeof input === "string" ? hexToBytes(input) : input;
  const r = new Reader(bytes);
  const packed = r.u32();
  const version = BigInt.asIntN(16, BigInt(packed & 0xffff));
  const type = (packed >>> 16) & 0xffff;
  const vinCount = r.compactSize();
  const vin: TxIn[] = [];
  for (let i = 0; i < vinCount; i++) {
    const prevout = readOutPoint(r);
    const scriptSig = r.varBytes();
    vin.push({ prevout, scriptSig, sequence: r.u32() });
  }
  const voutCount = r.compactSize();
  const vout: TxOut[] = [];
  for (let i = 0; i < voutCount; i++) {
    const value = r.i64();
    vout.push({ value, script: r.varBytes() });
  }
  const lockTime = r.u32();
  const tx: Tx = { version: Number(version), type, vin, vout, lockTime, extraPayload: new Uint8Array() };
  if (hasExtraPayload(tx.version, type)) tx.extraPayload = r.varBytes();
  r.end("transaction");
  return tx;
}

export function encodeTx(tx: Tx): Bytes {
  const w = new Writer();
  w.u32(((tx.version & 0xffff) | ((tx.type & 0xffff) << 16)) >>> 0);
  w.compactSize(tx.vin.length);
  for (const i of tx.vin) {
    writeOutPoint(w, i.prevout);
    w.varBytes(i.scriptSig).u32(i.sequence);
  }
  w.compactSize(tx.vout.length);
  for (const o of tx.vout) writeTxOut(w, o);
  w.u32(tx.lockTime);
  if (hasExtraPayload(tx.version, tx.type)) w.varBytes(tx.extraPayload);
  return w.finish();
}

export function encodeTxHex(tx: Tx): string {
  return bytesToHex(encodeTx(tx));
}

/** The txid as Core displays it: double-SHA256 of the serialization, byte-reversed */
export function txid(tx: Tx | Bytes): string {
  const bytes = tx instanceof Uint8Array ? tx : encodeTx(tx);
  return uint256ToHex(sha256d(bytes));
}

/** CalcTxInputsHash (src/evo/specialtx.cpp): SHA256d over every prevout */
export function calcTxInputsHash(tx: Tx): Bytes {
  const w = new Writer();
  for (const i of tx.vin) writeOutPoint(w, i.prevout);
  return sha256d(w.finish());
}

/** CalcTxOutputsHash (src/evo/specialtx.cpp): SHA256d over every output */
export function calcTxOutputsHash(tx: Tx): Bytes {
  const w = new Writer();
  for (const o of tx.vout) writeTxOut(w, o);
  return sha256d(w.finish());
}

export function tryDecodeTx(input: string | Bytes): Tx | undefined {
  try {
    return decodeTx(input);
  } catch (e) {
    if (e instanceof DecodeError) return undefined;
    throw e;
  }
}
