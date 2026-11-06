// Amounts and percentages as Cairn writes them. Amounts are duffs (numbers: every Cairn amount is far below 2^53).
import { COIN, formatDash, tryParseDash } from '@cairn/shares';

export const DUFFS = Number(COIN);

/** "300 DASH", "12.5 DASH". */
export const dash = (duffs: number | bigint): string => `${formatDash(BigInt(duffs), { groupSeparator: ',' })} DASH`;
/** "300" without the unit, for inputs and tight spots. */
export const dashNum = (duffs: number | bigint): string => formatDash(BigInt(duffs));
/** Basis points as a percentage: "10%", "12.5%". */
export const pct = (bps: number): string => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

/** Typed DASH ("300", "12.5") to duffs, or null when it is not an exact amount. */
export function parseDashInput(text: string): number | null {
  const v = tryParseDash(text.trim().replace(/\s*dash$/i, ''));
  return v === undefined || v > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(v);
}

/** Typed percent ("10", "12.5%") to basis points 0..10000, or null. */
export function parsePercentInput(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

export const bpsInput = (bps: number): string => String(bps / 100);

export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
