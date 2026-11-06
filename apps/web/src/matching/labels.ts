// Share labels: the row names the coordinator types into Dash-Qt's Participants page, fixed in the roster before lock so every
// member computes the same term sheet. Dash-Qt and Cairn's checker match rows by label (case-insensitively as a fallback), so
// labels are short, plain ASCII and unique ignoring case.
import { cleanName } from '@cairn/contract';

export const MAX_LABEL = 20;
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/** A name reduced to a label: accents dropped, anything outside letters, digits, space, dot, dash and underscore removed. */
export function asciiLabel(name: string): string {
  const base = cleanName(name)
    .replace(/\.dash$/i, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/^[ ._-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base.slice(0, MAX_LABEL).trim();
}

/** Why a label cannot be used, or null. `others` are the other shares' labels. */
export function labelProblem(label: string, others: readonly string[]): string | null {
  if (!label) return 'Give every share a label.';
  if (label !== label.trim() || /\s{2}/.test(label)) return 'No spaces at the start or end, and single spaces only.';
  if (label.length > MAX_LABEL) return `Up to ${MAX_LABEL} characters.`;
  if (!ALLOWED.test(label)) return 'Letters, digits, spaces, dots, dashes and underscores only (plain ASCII, as typed in Dash-Qt).';
  if (others.some((o) => o.toLowerCase() === label.toLowerCase())) return 'Two shares cannot have the same label.';
  return null;
}

/**
 * A label for every share: the one already set when it is still valid, else one derived from the person's name, else "Member N";
 * numbered when two would collide.
 */
export function deriveLabels(shares: ReadonlyArray<{ id: string; label?: string }>, nameOf: (id: string) => string | null): string[] {
  const out: string[] = [];
  const taken = (l: string) => out.some((o) => o.toLowerCase() === l.toLowerCase());
  shares.forEach((s, i) => {
    const keep = s.label && !labelProblem(s.label, out) ? s.label : null;
    let base = keep ?? (asciiLabel(nameOf(s.id) ?? '') || `Member ${i + 1}`);
    if (!keep && base.length < 2) base = `Member ${i + 1}`;
    let label = base;
    for (let n = 2; taken(label); n++) label = `${base.slice(0, MAX_LABEL - String(n).length - 1).trim()} ${n}`;
    out.push(label);
  });
  return out;
}
