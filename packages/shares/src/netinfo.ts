import { type Bytes, DecodeError, Reader, Writer, bytesToHex, equalBytes } from "./bytes.ts";

/** NetInfoPurpose (src/evo/netinfo.h) */
export const NetInfoPurpose = { CORE_P2P: 0, PLATFORM_P2P: 1, PLATFORM_HTTPS: 2 } as const;

export type ServiceNet = "ipv4" | "ipv6" | "torv3" | "i2p" | "cjdns";

export type NetEntry =
  | { type: "service"; net: ServiceNet; addr: Bytes; port: number }
  | { type: "domain"; host: string; port: number };

export type NetInfo =
  /** MnNetInfo: one CService in V1 (16-byte IPv6-mapped) form, ProTx versions 1-2 */
  | { kind: "legacy"; addr: Bytes; port: number }
  /** ExtNetInfo (ProTx version 3) */
  | { kind: "ext"; version: number; purposes: Array<{ purpose: number; entries: NetEntry[] }> };

const BIP155: Record<number, { net: ServiceNet; size: number }> = {
  1: { net: "ipv4", size: 4 },
  2: { net: "ipv6", size: 16 },
  4: { net: "torv3", size: 32 },
  5: { net: "i2p", size: 32 },
  6: { net: "cjdns", size: 16 },
};
const BIP155_ID: Record<ServiceNet, number> = { ipv4: 1, ipv6: 2, torv3: 4, i2p: 5, cjdns: 6 };
const IPV4_IN_IPV6 = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff);
const INTERNAL_IN_IPV6 = Uint8Array.of(0xfd, 0x6b, 0x88, 0xc0, 0x87, 0x24);
const TORV2_IN_IPV6 = Uint8Array.of(0xfd, 0x87, 0xd8, 0x7e, 0xeb, 0x43);
const DOMAIN_MAX_LEN = 253;

function hasPrefix(a: Bytes, p: Bytes): boolean {
  return a.length >= p.length && equalBytes(a.subarray(0, p.length), p);
}

/**
 * Read one NetInfoEntry. Core silently turns malformed or unknown entries into an "invalid"
 * marker and re-serializes them differently; such entries never come out of Core's own RPCs, so
 * service entries of unknown type or size are refused here. Domain entries are kept verbatim
 * (Core may clear invalid ones), which can only make a digest check fail, never pass.
 */
function readEntry(r: Reader): NetEntry {
  const type = r.u8();
  if (type === 0x01) {
    const id = r.u8();
    const size = r.compactSize();
    const spec = BIP155[id];
    if (!spec || spec.size !== size) throw new DecodeError("unsupported netInfo address type");
    const addr = r.bytes(size);
    if (
      spec.net === "ipv6" &&
      (hasPrefix(addr, IPV4_IN_IPV6) || hasPrefix(addr, INTERNAL_IN_IPV6) || hasPrefix(addr, TORV2_IN_IPV6))
    ) {
      throw new DecodeError("unsupported embedded IPv6 netInfo address");
    }
    if (addr.every((b) => b === 0) || (spec.net === "ipv4" && addr.every((b) => b === 0xff))) {
      throw new DecodeError("invalid netInfo address");
    }
    return { type: "service", net: spec.net, addr, port: r.u16be() };
  }
  if (type === 0x02) {
    const len = r.compactSize();
    if (len > DOMAIN_MAX_LEN) throw new DecodeError("netInfo domain too long");
    const raw = r.bytes(len);
    let host = "";
    for (const b of raw) {
      if (b > 0x7f) throw new DecodeError("netInfo domain is not ASCII");
      host += String.fromCharCode(b);
    }
    return { type: "domain", host, port: r.u16be() };
  }
  throw new DecodeError("unsupported netInfo entry type");
}

function writeEntry(w: Writer, e: NetEntry): void {
  if (e.type === "service") {
    w.u8(0x01).u8(BIP155_ID[e.net]).compactSize(e.addr.length).bytes(e.addr).u16be(e.port);
  } else {
    w.u8(0x02).compactSize(e.host.length);
    for (let i = 0; i < e.host.length; i++) w.u8(e.host.charCodeAt(i));
    w.u16be(e.port);
  }
}

/** NetInfoSerWrapper unserialize: ExtNetInfo when the ProTx version is >= 3, else MnNetInfo */
export function readNetInfo(r: Reader, extended: boolean): NetInfo {
  if (!extended) {
    const addr = r.bytes(16);
    return { kind: "legacy", addr, port: r.u16be() };
  }
  const version = r.u8();
  if (version !== 1) {
    // Core stops reading an unknown ExtNetInfo version right after the version byte
    return { kind: "ext", version, purposes: [] };
  }
  const n = r.compactSize();
  const purposes: Array<{ purpose: number; entries: NetEntry[] }> = [];
  for (let i = 0; i < n; i++) {
    const purpose = r.u8();
    if (purpose > 2 || (purposes.length > 0 && purpose <= purposes[purposes.length - 1]!.purpose)) {
      throw new DecodeError("ExtNetInfo: purpose unknown or out of order");
    }
    const count = r.compactSize();
    const entries: NetEntry[] = [];
    for (let j = 0; j < count; j++) entries.push(readEntry(r));
    purposes.push({ purpose, entries });
  }
  return { kind: "ext", version, purposes };
}

export function writeNetInfo(w: Writer, ni: NetInfo): void {
  if (ni.kind === "legacy") {
    w.bytes(ni.addr).u16be(ni.port);
    return;
  }
  w.u8(ni.version);
  if (ni.version !== 1) return;
  w.compactSize(ni.purposes.length);
  for (const p of ni.purposes) {
    w.u8(p.purpose).compactSize(p.entries.length);
    for (const e of p.entries) writeEntry(w, e);
  }
}

export function encodeNetInfo(ni: NetInfo): Bytes {
  const w = new Writer();
  writeNetInfo(w, ni);
  return w.finish();
}

export function emptyExtNetInfo(): NetInfo {
  return { kind: "ext", version: 1, purposes: [] };
}

export function isNetInfoEmpty(ni: NetInfo): boolean {
  if (ni.kind === "legacy") return ni.addr.every((b) => b === 0) && ni.port === 0;
  return ni.version === 1 && ni.purposes.length === 0;
}

function ipv6ToString(addr: Bytes): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((addr[i]! << 8) | addr[i + 1]!);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(":");
  return hex.slice(0, bestStart).join(":") + "::" + hex.slice(bestStart + bestLen).join(":");
}

export function netEntryToString(e: NetEntry): string {
  if (e.type === "domain") return `${e.host}:${e.port}`;
  switch (e.net) {
    case "ipv4":
      return `${Array.from(e.addr).join(".")}:${e.port}`;
    case "ipv6":
    case "cjdns":
      return `[${ipv6ToString(e.addr)}]:${e.port}`;
    default:
      return `${e.net}:${bytesToHex(e.addr)}:${e.port}`;
  }
}

/** Core P2P service entries as "ip:port" strings (IPv6 bracketed), in payload order */
export function coreP2PEntries(ni: NetInfo): string[] {
  if (ni.kind === "legacy") {
    if (isNetInfoEmpty(ni)) return [];
    const e: NetEntry = hasPrefix(ni.addr, IPV4_IN_IPV6)
      ? { type: "service", net: "ipv4", addr: ni.addr.subarray(12), port: ni.port }
      : { type: "service", net: "ipv6", addr: ni.addr, port: ni.port };
    return [netEntryToString(e)];
  }
  return (ni.purposes.find((p) => p.purpose === NetInfoPurpose.CORE_P2P)?.entries ?? []).map(netEntryToString);
}

function parseIPv4(s: string): Bytes | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i]!;
    if (!/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255) return undefined;
    out[i] = Number(p);
  }
  return out;
}

function parseIPv6(s: string): Bytes | undefined {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return undefined;
  let tail: Bytes = new Uint8Array();
  let body = s;
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return undefined;
    tail = v4;
    body = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = body.split("::");
  if (halves.length > 2) return undefined;
  const parse = (h: string) => (h === "" ? [] : h.split(":"));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups = [...head, ...rest];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return undefined;
  if (halves.length === 1 ? groups.length !== 8 : groups.length > 7) return undefined;
  const fill = 8 - groups.length;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const out = new Uint8Array(16);
  all.forEach((g, i) => {
    const v = parseInt(g, 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  if (tail.length) out.set(tail, 12);
  return out;
}

/**
 * Parse one "ip:port" service as ExtNetInfo::AddEntry would store it for CORE_P2P:
 * IPv4 "a.b.c.d:port" or IPv6 "[addr]:port" (fc00::/8 becomes CJDNS, as MaybeFlipIPv6toCJDNS does).
 * Domains, onion and I2P names are not supported here and return undefined.
 */
export function parseServiceEntry(text: string): NetEntry | undefined {
  let host: string;
  let portStr: string;
  const v6 = /^\[([^\]]+)\]:(\d{1,5})$/.exec(text);
  if (v6) {
    host = v6[1]!;
    portStr = v6[2]!;
  } else {
    const m = /^([^:[\]]+):(\d{1,5})$/.exec(text);
    if (!m) return undefined;
    host = m[1]!;
    portStr = m[2]!;
  }
  const port = Number(portStr);
  if (port < 1 || port > 65535) return undefined;
  if (!v6) {
    const addr = parseIPv4(host);
    if (!addr || addr.every((b) => b === 0) || addr.every((b) => b === 0xff)) return undefined;
    return { type: "service", net: "ipv4", addr, port };
  }
  const addr = parseIPv6(host);
  if (!addr || addr.every((b) => b === 0) || hasPrefix(addr, IPV4_IN_IPV6)) return undefined;
  return { type: "service", net: addr[0] === 0xfc ? "cjdns" : "ipv6", addr, port };
}

/** Split like the Qt wizard (`[,\s]+`, empty parts skipped) */
export function splitServiceList(text: string): string[] {
  return text.split(/[,\t\n\v\f\r ]+/).filter((s) => s.length > 0);
}

/** The ExtNetInfo a comma/space separated Core P2P list produces, or undefined if any entry is unsupported or duplicated */
export function netInfoFromServiceList(text: string): NetInfo | undefined {
  const entries: NetEntry[] = [];
  for (const part of splitServiceList(text)) {
    const e = parseServiceEntry(part);
    if (!e || e.type !== "service") return undefined;
    if (entries.some((x) => x.type === "service" && equalBytes(x.addr, e.addr))) return undefined;
    entries.push(e);
  }
  if (entries.length > 4) return undefined;
  return { kind: "ext", version: 1, purposes: entries.length ? [{ purpose: NetInfoPurpose.CORE_P2P, entries }] : [] };
}

/** Port of the Qt wizard's NetInfoMatches (src/qt/mnsharesession.cpp): canonical comparison, not string comparison */
export function netInfoMatchesServiceList(ni: NetInfo, text: string): boolean {
  if (ni.kind !== "ext") return false;
  const expected = netInfoFromServiceList(text);
  return expected !== undefined && equalBytes(encodeNetInfo(expected), encodeNetInfo(ni));
}
