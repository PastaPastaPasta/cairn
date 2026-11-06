import { base58 } from "@scure/base";
import { type Bytes, concatBytes, equalBytes, sha256d } from "./bytes.ts";

/** Network names exactly as Dash Core's ChainTypeToString / the session envelope's `network` */
export type Network = "main" | "test" | "devnet" | "regtest";
export const NETWORKS: readonly Network[] = ["main", "test", "devnet", "regtest"];

export function isNetwork(v: unknown): v is Network {
  return typeof v === "string" && (NETWORKS as readonly string[]).includes(v);
}

export type AddressType = "p2pkh" | "p2sh";

/** base58Prefixes from src/kernel/chainparams.cpp (devnet and regtest share testnet's) */
export function addressPrefixes(network: Network): { p2pkh: number; p2sh: number } {
  return network === "main" ? { p2pkh: 76, p2sh: 16 } : { p2pkh: 140, p2sh: 19 };
}

export interface DecodedAddress {
  type: AddressType;
  /** 20-byte key ID (P2PKH) or script hash (P2SH) */
  hash: Bytes;
  /** "main" or the testnet-family prefix (test/devnet/regtest are indistinguishable) */
  family: "main" | "test";
}

function checksum(payload: Bytes): Bytes {
  return sha256d(payload).subarray(0, 4);
}

/** Decode a base58check Dash address; returns undefined when it is not one. */
export function decodeAddress(address: string, network?: Network): DecodedAddress | undefined {
  let raw: Bytes;
  try {
    raw = base58.decode(address);
  } catch {
    return undefined;
  }
  if (raw.length !== 25) return undefined;
  const payload = raw.subarray(0, 21);
  if (!equalBytes(checksum(payload), raw.subarray(21))) return undefined;
  const version = payload[0]!;
  const hash = Uint8Array.from(payload.subarray(1));
  const candidates: Array<[Network, "main" | "test"]> = network
    ? [[network, network === "main" ? "main" : "test"]]
    : [
        ["main", "main"],
        ["test", "test"],
      ];
  for (const [net, family] of candidates) {
    const p = addressPrefixes(net);
    if (version === p.p2pkh) return { type: "p2pkh", hash, family };
    if (version === p.p2sh) return { type: "p2sh", hash, family };
  }
  return undefined;
}

export function encodeAddress(hash: Bytes, type: AddressType, network: Network): string {
  if (hash.length !== 20) throw new Error("address hash must be 20 bytes");
  const p = addressPrefixes(network);
  const payload = concatBytes(Uint8Array.of(type === "p2pkh" ? p.p2pkh : p.p2sh), hash);
  return base58.encode(concatBytes(payload, checksum(payload)));
}

export function isValidAddress(address: string, network: Network, type?: AddressType): boolean {
  const d = decodeAddress(address, network);
  return d !== undefined && (type === undefined || d.type === type);
}

export function p2pkhScript(keyId: Bytes): Bytes {
  if (keyId.length !== 20) throw new Error("key ID must be 20 bytes");
  return concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), keyId, Uint8Array.of(0x88, 0xac));
}

export function p2shScript(scriptHash: Bytes): Bytes {
  if (scriptHash.length !== 20) throw new Error("script hash must be 20 bytes");
  return concatBytes(Uint8Array.of(0xa9, 0x14), scriptHash, Uint8Array.of(0x87));
}

/** CScript::IsPayToPublicKeyHash / IsPayToScriptHash: exact templates only */
export function parseStandardScript(script: Bytes): { type: AddressType; hash: Bytes } | undefined {
  if (
    script.length === 25 &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  ) {
    return { type: "p2pkh", hash: Uint8Array.from(script.subarray(3, 23)) };
  }
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    return { type: "p2sh", hash: Uint8Array.from(script.subarray(2, 22)) };
  }
  return undefined;
}

export function scriptToAddress(script: Bytes, network: Network): string | undefined {
  const s = parseStandardScript(script);
  return s ? encodeAddress(s.hash, s.type, network) : undefined;
}

export function addressToScript(address: string, network: Network): Bytes | undefined {
  const d = decodeAddress(address, network);
  if (!d) return undefined;
  return d.type === "p2pkh" ? p2pkhScript(d.hash) : p2shScript(d.hash);
}

/** The key ID of a P2PKH address (owner and voting addresses must be P2PKH) */
export function addressToKeyId(address: string, network: Network): Bytes | undefined {
  const d = decodeAddress(address, network);
  return d?.type === "p2pkh" ? d.hash : undefined;
}

export function keyIdToAddress(keyId: Bytes, network: Network): string {
  return encodeAddress(keyId, "p2pkh", network);
}
