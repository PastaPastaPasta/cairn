import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Bytes, Writer, equalBytes, hash160, sha256d, uint256FromHex, uint256ToHex, utf8 } from "./bytes.ts";
import { writeNetInfo } from "./netinfo.ts";
import {
  MnType,
  type ProDisTxPayload,
  type ProRegTxPayload,
  type ProUpShareTxPayload,
  type ProUpSharedRegTxPayload,
  encodeProUpShareTxPayload,
  encodeProUpSharedRegTxPayload,
  writeCollateralShare,
} from "./proregtx.ts";
import { type Tx, calcTxInputsHash, calcTxOutputsHash, writeOutPoint, writeTxOut } from "./tx.ts";

/**
 * A 32-byte digest in uint256 internal byte order (what is signed), with the hex Core displays
 * (uint256::ToString, byte-reversed), e.g. the `consentHash` from `protx shared_register_prepare`.
 */
export interface Digest {
  bytes: Bytes;
  hex: string;
}

function digest(bytes: Bytes): Digest {
  return { bytes, hex: uint256ToHex(bytes) };
}

export function digestFromHex(hex: string): Digest {
  return { bytes: uint256FromHex(hex.toLowerCase()), hex: hex.toLowerCase() };
}

function writeString(w: Writer, s: string): void {
  w.varBytes(utf8(s));
}

/** CProRegTx::MakeSharedRegConsentHash (src/evo/providertx.cpp:380-418) */
export function sharedRegConsentHash(tx: Tx, payload: ProRegTxPayload): Digest {
  const w = new Writer();
  writeString(w, "DashSharedMNReg");
  w.u16(payload.version);
  w.i16(tx.version);
  w.u16(tx.type);
  w.u32(tx.lockTime);
  w.bytes(calcTxInputsHash(tx));
  for (const i of tx.vin) w.u32(i.sequence);
  w.bytes(calcTxOutputsHash(tx));
  w.u16(payload.mnType);
  w.u16(payload.mode);
  writeNetInfo(w, payload.netInfo);
  if (payload.mnType === MnType.Evo) w.bytes(payload.platformNodeID);
  w.bytes(payload.keyIDVoting);
  w.bytes(payload.pubKeyOperator);
  w.u16(payload.operatorReward);
  w.u8(payload.shares.length);
  for (const s of payload.shares) writeCollateralShare(w, s);
  w.u32(payload.earlyPeriodBlocks);
  w.i64(payload.earlyPenalty);
  return digest(sha256d(w.finish()));
}

/** CProDisTx::MakeSignHash (src/evo/providertx.cpp:546-573); sigCount selects unilateral (1) or unanimous (N) */
export function proDisSignHash(tx: Tx, payload: ProDisTxPayload, sigCount: number): Digest {
  const w = new Writer();
  writeString(w, "DashSharedMNDissolve");
  w.u16(payload.version);
  w.i16(tx.version);
  w.u16(tx.type);
  w.u32(tx.lockTime);
  for (const i of tx.vin) writeOutPoint(w, i.prevout);
  for (const i of tx.vin) w.u32(i.sequence);
  for (const o of tx.vout) writeTxOut(w, o);
  w.bytes(uint256FromHex(payload.proTxHash));
  w.u16(payload.actorIndex);
  w.u8(sigCount);
  return digest(sha256d(w.finish()));
}

/** ::SerializeHash(CProUpShareTx) under SER_GETHASH (no vchSig), as CheckProUpShareTx verifies */
export function proUpShareSignHash(payload: ProUpShareTxPayload): Digest {
  return digest(sha256d(encodeProUpShareTxPayload(payload, true)));
}

/** ::SerializeHash(CProUpSharedRegTx) under SER_GETHASH (no signatures) */
export function proUpSharedRegSignHash(payload: ProUpSharedRegTxPayload): Digest {
  return digest(sha256d(encodeProUpSharedRegTxPayload(payload, true)));
}

const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

function bytesToBigInt(b: Bytes): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

export interface RecoveredKey {
  /** serialized public key (33 bytes compressed or 65 uncompressed, per the header's compression flag) */
  pubKey: Bytes;
  compressed: boolean;
  /** CKeyID = HASH160(pubKey) */
  keyId: Bytes;
}

/**
 * CPubKey::RecoverCompact over a 32-byte digest in internal byte order. Like Core it accepts any
 * header byte and masks it; use verifyCompactCanonical for consensus-equivalent checks.
 */
export function recoverCompact(digest32: Bytes, sig: Bytes): RecoveredKey | undefined {
  if (sig.length !== 65 || digest32.length !== 32) return undefined;
  const header = sig[0]!;
  const recid = (header - 27) & 3;
  const compressed = ((header - 27) & 4) !== 0;
  const r = bytesToBigInt(sig.subarray(1, 33));
  const s = bytesToBigInt(sig.subarray(33, 65));
  try {
    const point = new secp256k1.Signature(r, s, recid).recoverPublicKey(digest32);
    const pubKey = point.toBytes(compressed);
    return { pubKey, compressed, keyId: hash160(pubKey) };
  } catch {
    return undefined;
  }
}

export type CompactSigFailure = "size" | "header" | "high-s" | "recover" | "key-mismatch";

export interface CompactSigCheck {
  ok: boolean;
  reason?: CompactSigFailure;
  /** key ID the signature recovers to, when recoverable */
  recoveredKeyId?: Bytes;
}

/** CHashSigner::VerifyHashCanonical (src/messagesigner.cpp:58-90): 65 bytes, header 27..34, low-S, recovers keyId */
export function verifyCompactCanonical(digest32: Bytes, keyId: Bytes, sig: Bytes): CompactSigCheck {
  if (sig.length !== 65) return { ok: false, reason: "size" };
  if (sig[0]! < 27 || sig[0]! > 34) return { ok: false, reason: "header" };
  if (bytesToBigInt(sig.subarray(33, 65)) > SECP256K1_HALF_ORDER) return { ok: false, reason: "high-s" };
  const rec = recoverCompact(digest32, sig);
  if (!rec) return { ok: false, reason: "recover" };
  if (!equalBytes(rec.keyId, keyId)) return { ok: false, reason: "key-mismatch", recoveredKeyId: rec.keyId };
  return { ok: true, recoveredKeyId: rec.keyId };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Core's DecodeBase64 (src/util/strencodings.cpp): length % 4 == 0, up to two '=', zero padding bits */
export function decodeBase64Core(str: string): Bytes | undefined {
  if (str.length % 4 !== 0) return undefined;
  let s = str;
  if (s.endsWith("=")) s = s.slice(0, -1);
  if (s.endsWith("=")) s = s.slice(0, -1);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0 || ch.length !== 1) return undefined;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 6 || (acc & ((1 << bits) - 1)) !== 0) return undefined;
  return Uint8Array.from(out);
}

export function encodeBase64(bytes: Bytes): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=";
    out += i + 2 < bytes.length ? B64[n & 63]! : "=";
  }
  return out;
}

export interface JoinSigResult {
  shareIndex: number;
  ok: boolean;
  reason?: CompactSigFailure;
  recoveredKeyId?: Bytes;
}

/** Verify every vchJoinSigs entry against its share's keyIDOwner, as CheckProRegTx does */
export function verifyJoinSigs(tx: Tx, payload: ProRegTxPayload): { consentHash: Digest; results: JoinSigResult[] } {
  const consentHash = sharedRegConsentHash(tx, payload);
  const results = payload.shares.map((share, i) => {
    const sig = payload.joinSigs[i] ?? new Uint8Array();
    return { shareIndex: i, ...verifyCompactCanonical(consentHash.bytes, share.keyIDOwner, sig) };
  });
  return { consentHash, results };
}
