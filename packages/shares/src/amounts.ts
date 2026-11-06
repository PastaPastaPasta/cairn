/** 1 DASH in duffs (Core's COIN) */
export const COIN = 100_000_000n;
/** Core's MAX_MONEY (21M DASH-scale cap used by MoneyRange) */
export const MAX_MONEY = 21_000_000n * COIN;

export function moneyRange(duffs: bigint): boolean {
  return duffs >= 0n && duffs <= MAX_MONEY;
}

export class AmountError extends Error {
  override name = "AmountError";
}

const DASH_RE = /^(-)?(\d+)(?:\.(\d{1,8}))?$/;

/**
 * Parse a decimal DASH amount ("1000", "12.5", "0.00000001") into duffs, exactly.
 * Rejects more than 8 decimals, exponents, grouping separators, and empty fractions ("1.").
 * Negative amounts are rejected unless `allowNegative`.
 */
export function parseDash(text: string, opts: { allowNegative?: boolean } = {}): bigint {
  const m = DASH_RE.exec(text.trim());
  if (!m) throw new AmountError(`not a DASH amount: ${JSON.stringify(text)}`);
  const [, sign, whole, frac = ""] = m;
  const duffs = BigInt(whole!) * COIN + BigInt(frac.padEnd(8, "0"));
  if (sign) {
    if (!opts.allowNegative) throw new AmountError("amount must not be negative");
    return -duffs;
  }
  return duffs;
}

export function tryParseDash(text: string): bigint | undefined {
  try {
    return parseDash(text);
  } catch {
    return undefined;
  }
}

export interface FormatDashOptions {
  /** Minimum number of decimals to keep (default 0: "1000", "12.5"). Max 8. */
  minDecimals?: number;
  /** Insert a separator between thousands of the integer part (default none) */
  groupSeparator?: string;
  /** Append a unit, e.g. "DASH" or "tDASH" (separated by a space) */
  unit?: string;
}

/** Format duffs as a decimal DASH string; trailing zero decimals are trimmed down to `minDecimals`. */
export function formatDash(duffs: bigint, opts: FormatDashOptions = {}): string {
  const minDecimals = Math.max(0, Math.min(8, opts.minDecimals ?? 0));
  const neg = duffs < 0n;
  const abs = neg ? -duffs : duffs;
  let whole = (abs / COIN).toString();
  let frac = (abs % COIN).toString().padStart(8, "0");
  let end = frac.length;
  while (end > minDecimals && frac[end - 1] === "0") end--;
  frac = frac.slice(0, end);
  if (opts.groupSeparator) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, opts.groupSeparator);
  const num = (neg ? "-" : "") + whole + (frac ? "." + frac : "");
  return opts.unit ? `${num} ${opts.unit}` : num;
}

/** Whole DASH to duffs, e.g. dash(100) === 10_000_000_000n */
export function dash(whole: number | bigint): bigint {
  if (typeof whole === "number" && !Number.isSafeInteger(whole)) throw new AmountError("dash() takes whole DASH");
  return BigInt(whole) * COIN;
}
