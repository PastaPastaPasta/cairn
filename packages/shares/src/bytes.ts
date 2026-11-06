import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type Bytes = Uint8Array;

export class DecodeError extends Error {
  override name = "DecodeError";
}

const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

export function isHex(s: string): boolean {
  return HEX_RE.test(s);
}

export function hexToBytes(hex: string): Bytes {
  if (!isHex(hex)) throw new DecodeError("not an even-length hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Bytes): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function concatBytes(...parts: Bytes[]): Bytes {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function equalBytes(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function reversed(bytes: Bytes): Bytes {
  return Uint8Array.from(bytes).reverse();
}

/** uint256 internal byte order -> the hex Core displays (uint256::ToString reverses) */
export function uint256ToHex(internal: Bytes): string {
  if (internal.length !== 32) throw new DecodeError("uint256 must be 32 bytes");
  return bytesToHex(reversed(internal));
}

/** Displayed uint256 hex -> internal byte order (strict: exactly 64 hex chars) */
export function uint256FromHex(hex: string): Bytes {
  if (hex.length !== 64 || !isHex(hex)) throw new DecodeError("uint256 hex must be 64 hex characters");
  return reversed(hexToBytes(hex));
}

export function sha256d(data: Bytes): Bytes {
  return sha256(sha256(data));
}

export function hash160(data: Bytes): Bytes {
  return ripemd160(sha256(data));
}

export { sha256 };

/** UTF-8 encode (lone surrogates become U+FFFD, as TextEncoder does) */
export function utf8(s: string): Bytes {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Little-endian reader over Core's serialization primitives */
export class Reader {
  pos = 0;
  constructor(readonly buf: Bytes) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  bytes(n: number): Bytes {
    if (n < 0 || this.pos + n > this.buf.length) throw new DecodeError("unexpected end of data");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Uint8Array.from(out);
  }

  u8(): number {
    if (this.pos >= this.buf.length) throw new DecodeError("unexpected end of data");
    return this.buf[this.pos++]!;
  }

  u16(): number {
    const b = this.bytes(2);
    return b[0]! | (b[1]! << 8);
  }

  u16be(): number {
    const b = this.bytes(2);
    return (b[0]! << 8) | b[1]!;
  }

  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u32(): number {
    const b = this.bytes(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  u64(): bigint {
    const lo = BigInt(this.u32());
    const hi = BigInt(this.u32());
    return (hi << 32n) | lo;
  }

  i64(): bigint {
    return BigInt.asIntN(64, this.u64());
  }

  /** Core ReadCompactSize with range_check (MAX_SIZE 0x02000000) and canonical-encoding checks */
  compactSize(): number {
    const first = this.u8();
    let n: bigint;
    if (first < 253) {
      n = BigInt(first);
    } else if (first === 253) {
      n = BigInt(this.u16());
      if (n < 253n) throw new DecodeError("non-canonical ReadCompactSize()");
    } else if (first === 254) {
      n = BigInt(this.u32());
      if (n < 0x10000n) throw new DecodeError("non-canonical ReadCompactSize()");
    } else {
      n = this.u64();
      if (n < 0x100000000n) throw new DecodeError("non-canonical ReadCompactSize()");
    }
    if (n > 0x02000000n) throw new DecodeError("ReadCompactSize(): size too large");
    return Number(n);
  }

  varBytes(): Bytes {
    return this.bytes(this.compactSize());
  }

  end(what: string): void {
    if (this.pos !== this.buf.length) throw new DecodeError(`${what}: trailing data`);
  }
}

export class Writer {
  private parts: number[] = [];

  u8(v: number): this {
    this.parts.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    return this.u8(v).u8(v >>> 8);
  }

  u16be(v: number): this {
    return this.u8(v >>> 8).u8(v);
  }

  i16(v: number): this {
    return this.u16(v & 0xffff);
  }

  u32(v: number): this {
    return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24);
  }

  u64(v: bigint): this {
    const u = BigInt.asUintN(64, v);
    return this.u32(Number(u & 0xffffffffn)).u32(Number(u >> 32n));
  }

  i64(v: bigint): this {
    return this.u64(v);
  }

  compactSize(n: number): this {
    if (n < 253) return this.u8(n);
    if (n <= 0xffff) return this.u8(253).u16(n);
    if (n <= 0xffffffff) return this.u8(254).u32(n);
    return this.u8(255).u64(BigInt(n));
  }

  bytes(b: Bytes): this {
    for (const x of b) this.parts.push(x);
    return this;
  }

  varBytes(b: Bytes): this {
    return this.compactSize(b.length).bytes(b);
  }

  finish(): Bytes {
    return Uint8Array.from(this.parts);
  }
}
