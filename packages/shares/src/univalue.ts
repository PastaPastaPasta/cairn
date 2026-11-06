/**
 * A byte-faithful port of Dash Core's UniValue reader and writer (src/univalue/lib), needed to
 * reproduce envelope fingerprints: Core re-writes the *parsed* envelope with write(2), so key
 * order, duplicate keys, raw number tokens and string bytes must survive exactly as UniValue
 * keeps them. JSON.parse cannot do that (it reorders integer-like keys and normalizes numbers).
 */
import { type Bytes, equalBytes, utf8 } from "./bytes.ts";

export type UniValue =
  | { type: "null" }
  | { type: "bool"; value: boolean }
  /** raw number token text, exactly as read */
  | { type: "num"; raw: string }
  /** UTF-8 bytes after UniValue's escape/UTF-8 filter, plus a JS string view of them */
  | { type: "str"; bytes: Bytes; value: string }
  | { type: "arr"; values: UniValue[] }
  | { type: "obj"; keys: Bytes[]; keyStrings: string[]; values: UniValue[] };

const MAX_JSON_DEPTH = 512;

/** Lenient UTF-8 to JS string (invalid sequences become U+FFFD); display only */
export function decodeUtf8(bytes: Bytes): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      n = 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      n = 3;
    } else if (b >= 0xf0 && b < 0xf8 && i + 3 < bytes.length) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      n = 4;
    }
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

/** JSONUTF8StringFilter (univalue_utffilter.h), including its acceptance of overlong forms */
class Utf8Filter {
  out: number[] = [];
  valid = true;
  private codepoint = 0;
  private state = 0;
  private surpair = 0;

  pushByte(ch: number): void {
    if (this.state === 0) {
      if (ch < 0x80) this.out.push(ch);
      else if (ch < 0xc0) this.valid = false;
      else if (ch < 0xe0) {
        this.codepoint = (ch & 0x1f) << 6;
        this.state = 6;
      } else if (ch < 0xf0) {
        this.codepoint = (ch & 0x0f) << 12;
        this.state = 12;
      } else if (ch < 0xf8) {
        this.codepoint = (ch & 0x07) << 18;
        this.state = 18;
      } else this.valid = false;
    } else {
      if ((ch & 0xc0) !== 0x80) this.valid = false;
      this.state -= 6;
      this.codepoint |= (ch & 0x3f) << this.state;
      if (this.state === 0) this.pushCodepoint(this.codepoint);
    }
  }

  pushCodepoint(cp: number): void {
    if (this.state) this.valid = false;
    if (cp >= 0xd800 && cp < 0xdc00) {
      if (this.surpair) this.valid = false;
      else this.surpair = cp;
    } else if (cp >= 0xdc00 && cp < 0xe000) {
      if (this.surpair) {
        this.append(0x10000 | ((this.surpair - 0xd800) << 10) | (cp - 0xdc00));
        this.surpair = 0;
      } else this.valid = false;
    } else {
      if (this.surpair) this.valid = false;
      else this.append(cp);
    }
  }

  finalize(): boolean {
    if (this.state || this.surpair) this.valid = false;
    return this.valid;
  }

  private append(cp: number): void {
    const o = this.out;
    if (cp <= 0x7f) o.push(cp);
    else if (cp <= 0x7ff) o.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp <= 0xffff) o.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else if (cp <= 0x1fffff)
      o.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
}

class ParseFail extends Error {}

function isSpace(c: number | undefined): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}
function isDigit(c: number | undefined): boolean {
  return c !== undefined && c >= 0x30 && c <= 0x39;
}
function hexVal(c: number | undefined): number {
  if (c === undefined) return -1;
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

class Parser {
  pos = 0;
  constructor(private readonly s: Bytes) {}

  skipWs(): void {
    while (isSpace(this.s[this.pos])) this.pos++;
  }

  value(depth: number): UniValue {
    this.skipWs();
    const c = this.s[this.pos];
    if (c === undefined) throw new ParseFail();
    if (c === 0x7b) return this.object(depth + 1);
    if (c === 0x5b) return this.array(depth + 1);
    if (c === 0x22) {
      const bytes = this.string();
      return { type: "str", bytes, value: decodeUtf8(bytes) };
    }
    if (c === 0x2d || isDigit(c)) return { type: "num", raw: this.number() };
    for (const [word, v] of [
      ["null", { type: "null" }],
      ["true", { type: "bool", value: true }],
      ["false", { type: "bool", value: false }],
    ] as const) {
      if (this.matchWord(word)) return v;
    }
    throw new ParseFail();
  }

  private matchWord(word: string): boolean {
    for (let i = 0; i < word.length; i++) if (this.s[this.pos + i] !== word.charCodeAt(i)) return false;
    this.pos += word.length;
    return true;
  }

  private number(): string {
    const s = this.s;
    const start = this.pos;
    const firstDigit = s[start] === 0x2d ? start + 1 : start;
    if (s[firstDigit] === 0x30 && isDigit(s[firstDigit + 1])) throw new ParseFail();
    this.pos++;
    if (s[start] === 0x2d && this.pos < s.length && !isDigit(s[this.pos])) throw new ParseFail();
    while (isDigit(s[this.pos])) this.pos++;
    if (s[this.pos] === 0x2e) {
      this.pos++;
      if (!isDigit(s[this.pos])) throw new ParseFail();
      while (isDigit(s[this.pos])) this.pos++;
    }
    if (s[this.pos] === 0x65 || s[this.pos] === 0x45) {
      this.pos++;
      if (s[this.pos] === 0x2d || s[this.pos] === 0x2b) this.pos++;
      if (!isDigit(s[this.pos])) throw new ParseFail();
      while (isDigit(s[this.pos])) this.pos++;
    }
    let raw = "";
    for (let i = start; i < this.pos; i++) raw += String.fromCharCode(s[i]!);
    return raw;
  }

  private string(): Bytes {
    const s = this.s;
    this.pos++;
    const f = new Utf8Filter();
    for (;;) {
      const c = s[this.pos];
      if (c === undefined || c < 0x20) throw new ParseFail();
      if (c === 0x5c) {
        this.pos++;
        const e = s[this.pos];
        if (e === undefined) throw new ParseFail();
        switch (e) {
          case 0x22:
          case 0x5c:
          case 0x2f:
            f.pushByte(e);
            break;
          case 0x62:
            f.pushByte(0x08);
            break;
          case 0x66:
            f.pushByte(0x0c);
            break;
          case 0x6e:
            f.pushByte(0x0a);
            break;
          case 0x72:
            f.pushByte(0x0d);
            break;
          case 0x74:
            f.pushByte(0x09);
            break;
          case 0x75: {
            // UniValue requires a byte after the four hex digits (`raw + 1 + 4 >= end`)
            if (this.pos + 1 + 4 >= s.length) throw new ParseFail();
            let cp = 0;
            for (let i = 1; i <= 4; i++) {
              const h = hexVal(s[this.pos + i]);
              if (h < 0) throw new ParseFail();
              cp = cp * 16 + h;
            }
            f.pushCodepoint(cp);
            this.pos += 4;
            break;
          }
          default:
            throw new ParseFail();
        }
        this.pos++;
      } else if (c === 0x22) {
        this.pos++;
        break;
      } else {
        f.pushByte(c);
        this.pos++;
      }
    }
    if (!f.finalize()) throw new ParseFail();
    return Uint8Array.from(f.out);
  }

  private object(depth: number): UniValue {
    if (depth > MAX_JSON_DEPTH) throw new ParseFail();
    this.pos++;
    const keys: Bytes[] = [];
    const values: UniValue[] = [];
    this.skipWs();
    if (this.s[this.pos] === 0x7d) {
      this.pos++;
      return { type: "obj", keys, keyStrings: [], values };
    }
    for (;;) {
      this.skipWs();
      if (this.s[this.pos] !== 0x22) throw new ParseFail();
      keys.push(this.string());
      this.skipWs();
      if (this.s[this.pos] !== 0x3a) throw new ParseFail();
      this.pos++;
      values.push(this.value(depth));
      this.skipWs();
      const c = this.s[this.pos];
      if (c === 0x2c) {
        this.pos++;
        continue;
      }
      if (c === 0x7d) {
        this.pos++;
        return { type: "obj", keys, keyStrings: keys.map(decodeUtf8), values };
      }
      throw new ParseFail();
    }
  }

  private array(depth: number): UniValue {
    if (depth > MAX_JSON_DEPTH) throw new ParseFail();
    this.pos++;
    const values: UniValue[] = [];
    this.skipWs();
    if (this.s[this.pos] === 0x5d) {
      this.pos++;
      return { type: "arr", values };
    }
    for (;;) {
      values.push(this.value(depth));
      this.skipWs();
      const c = this.s[this.pos];
      if (c === 0x2c) {
        this.pos++;
        continue;
      }
      if (c === 0x5d) {
        this.pos++;
        return { type: "arr", values };
      }
      throw new ParseFail();
    }
  }
}

/** UniValue::read: returns undefined where Core's read() returns false */
export function readUniValue(input: string | Bytes): UniValue | undefined {
  const bytes = typeof input === "string" ? utf8(input) : input;
  const p = new Parser(bytes);
  try {
    const v = p.value(0);
    p.skipWs();
    if (p.pos !== bytes.length) return undefined;
    return v;
  } catch (e) {
    if (e instanceof ParseFail) return undefined;
    throw e;
  }
}

const ESCAPES: Record<number, string> = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r", 0x22: '\\"', 0x5c: "\\\\" };

function writeEscaped(out: number[], bytes: Bytes): void {
  for (const ch of bytes) {
    const esc = ESCAPES[ch] ?? (ch < 0x20 || ch === 0x7f ? "\\u" + ch.toString(16).padStart(4, "0") : undefined);
    if (esc === undefined) out.push(ch);
    else for (let i = 0; i < esc.length; i++) out.push(esc.charCodeAt(i));
  }
}

function pushAscii(out: number[], s: string): void {
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
}

function indent(out: number[], pretty: number, level: number): void {
  for (let i = 0; i < pretty * level; i++) out.push(0x20);
}

function writeInto(out: number[], v: UniValue, pretty: number, indentLevel: number): void {
  const modIndent = indentLevel === 0 ? 1 : indentLevel;
  switch (v.type) {
    case "null":
      pushAscii(out, "null");
      return;
    case "bool":
      pushAscii(out, v.value ? "true" : "false");
      return;
    case "num":
      pushAscii(out, v.raw);
      return;
    case "str":
      out.push(0x22);
      writeEscaped(out, v.bytes);
      out.push(0x22);
      return;
    case "arr": {
      out.push(0x5b);
      if (pretty) out.push(0x0a);
      v.values.forEach((item, i) => {
        if (pretty) indent(out, pretty, modIndent);
        writeInto(out, item, pretty, modIndent + 1);
        if (i !== v.values.length - 1) out.push(0x2c);
        if (pretty) out.push(0x0a);
      });
      if (pretty) indent(out, pretty, modIndent - 1);
      out.push(0x5d);
      return;
    }
    case "obj": {
      out.push(0x7b);
      if (pretty) out.push(0x0a);
      v.keys.forEach((key, i) => {
        if (pretty) indent(out, pretty, modIndent);
        out.push(0x22);
        writeEscaped(out, key);
        out.push(0x22, 0x3a);
        if (pretty) out.push(0x20);
        writeInto(out, v.values[i]!, pretty, modIndent + 1);
        if (i !== v.values.length - 1) out.push(0x2c);
        if (pretty) out.push(0x0a);
      });
      if (pretty) indent(out, pretty, modIndent - 1);
      out.push(0x7d);
      return;
    }
  }
}

/** UniValue::write(prettyIndent): the exact UTF-8 bytes Core produces */
export function writeUniValue(v: UniValue, prettyIndent = 0): Bytes {
  const out: number[] = [];
  writeInto(out, v, prettyIndent, 0);
  return Uint8Array.from(out);
}

// ---- Accessors mirroring UniValue's typed getters

function bytesEqualString(b: Bytes, s: string): boolean {
  const e = utf8(s);
  if (e.length !== b.length) return false;
  for (let i = 0; i < e.length; i++) if (e[i] !== b[i]) return false;
  return true;
}

/** find_value: the first value under `key`, or undefined (Core's NullUniValue) */
export function findValue(obj: UniValue, key: string): UniValue | undefined {
  if (obj.type !== "obj") return undefined;
  const i = obj.keys.findIndex((k) => bytesEqualString(k, key));
  return i < 0 ? undefined : obj.values[i];
}

export function isStr(v: UniValue | undefined): v is Extract<UniValue, { type: "str" }> {
  return v?.type === "str";
}

export function isNum(v: UniValue | undefined): v is Extract<UniValue, { type: "num" }> {
  return v?.type === "num";
}

export class UniValueTypeError extends Error {
  override name = "UniValueTypeError";
}

/**
 * UniValue::getInt<T>: std::from_chars over the whole raw token, in range for T.
 * Throws (as Core does) for fractions, exponents or out-of-range values.
 */
export function getInt(v: UniValue | undefined, bits: 32 | 64): bigint {
  if (v?.type !== "num") throw new UniValueTypeError("JSON value is not a number as expected");
  if (!/^-?\d+$/.test(v.raw)) throw new UniValueTypeError("JSON integer out of range");
  const n = BigInt(v.raw);
  const lim = 1n << BigInt(bits - 1);
  if (n < -lim || n >= lim) throw new UniValueTypeError("JSON integer out of range");
  return n;
}

/**
 * Copy of `obj` without `key` at top level, rebuilt with pushKV like Core's WithoutFingerprint:
 * a duplicate key keeps its first position and takes the later value.
 */
export function withoutKey(obj: UniValue, key: string): UniValue {
  if (obj.type !== "obj") return obj;
  const keys: Bytes[] = [];
  const values: UniValue[] = [];
  obj.keys.forEach((k, i) => {
    if (bytesEqualString(k, key)) return;
    const existing = keys.findIndex((x) => equalBytes(x, k));
    if (existing >= 0) values[existing] = obj.values[i]!;
    else {
      keys.push(k);
      values.push(obj.values[i]!);
    }
  });
  return { type: "obj", keys, keyStrings: keys.map(decodeUtf8), values };
}

/** Build a UniValue from plain data (objects keep insertion order; bigint and number become num) */
export function toUniValue(v: unknown): UniValue {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "boolean") return { type: "bool", value: v };
  if (typeof v === "bigint") return { type: "num", raw: v.toString() };
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new RangeError("only integers are supported");
    return { type: "num", raw: String(v) };
  }
  if (typeof v === "string") return { type: "str", bytes: utf8(v), value: v };
  if (Array.isArray(v)) return { type: "arr", values: v.map(toUniValue) };
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return {
      type: "obj",
      keys: entries.map(([k]) => utf8(k)),
      keyStrings: entries.map(([k]) => k),
      values: entries.map(([, x]) => toUniValue(x)),
    };
  }
  throw new TypeError(`cannot convert ${typeof v} to UniValue`);
}
