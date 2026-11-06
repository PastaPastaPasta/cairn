// The cairn: a group's progress to 1000 DASH as stacked stones. Each share is a stone sized by its amount and filled by its state;
// what is still open is an outlined space at the top. The drawing is decorative (aria-hidden); the caption and the list under it
// say the same in words, so nothing depends on colour or shape alone.
import { useId, type CSSProperties } from 'react';

export type StoneState = 'requested' | 'in' | 'approved' | 'signed';

export interface Stone {
  id: string;
  label: string;
  /** DASH (whole or fractional). */
  amount: number;
  state: StoneState;
  /** The viewer's own share: outlined in ochre. */
  mine?: boolean;
}

export const STATE_WORDS: Record<StoneState, string> = {
  requested: 'asked for a seat',
  in: 'in the group',
  approved: 'approved the terms',
  signed: 'signed in Dash Core',
};

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 8, useGrouping: n >= 10_000 });

/** Stable pseudo-random numbers in [0, 1) from a string: every stone keeps its shape between renders and visits. */
function rand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * A pebble filling the box: a superellipse (flat-ish top and bottom, round ends) with every outline point nudged a little, joined
 * by a smooth closed curve (Catmull-Rom as cubic Béziers). The seed fixes the nudges, so a stone keeps its shape.
 */
function stonePath(x: number, y: number, w: number, h: number, seed: string): string {
  const r = rand(seed);
  const n = 14;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const e = 2 / 2.7;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const j = 1 - r() * 0.07;
    // the underside sits a little flatter: stones rest on each other
    const sy = sn > 0 ? 1 : 0.94 + r() * 0.06;
    pts.push([cx + (w / 2) * j * Math.sign(c) * Math.abs(c) ** e, cy + (h / 2) * j * sy * Math.sign(sn) * Math.abs(sn) ** e]);
  }
  const p = (i: number) => pts[(i + n) % n]!;
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(p(0)[0])},${f(p(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d} Z`;
}

export function cairnSummary(stones: readonly Stone[], total: number): string {
  const counted = stones.filter((s) => s.state !== 'requested');
  const sum = counted.reduce((a, s) => a + s.amount, 0);
  const open = Math.max(0, total - sum);
  const asked = stones.filter((s) => s.state === 'requested');
  const people = counted.length === 1 ? 'one co-owner' : `${counted.length} co-owners`;
  const parts = [`${fmt(sum)} of ${fmt(total)} DASH from ${people}.`];
  parts.push(open > 0 ? `${fmt(open)} DASH still open.` : 'Full.');
  if (asked.length) parts.push(`${asked.length === 1 ? 'One person has' : `${asked.length} people have`} asked for a seat.`);
  return parts.join(' ');
}

interface Props {
  stones: readonly Stone[];
  /** DASH the masternode needs (1000 for a regular masternode). */
  total?: number;
  /** 'stack': the tall cairn; 'row': a compact line of stones for lists. */
  variant?: 'stack' | 'row';
  /** Settle the stones in once on first paint (off under reduced motion). */
  animate?: boolean;
  /** Show the share list under the drawing (the stack variant always has the caption). */
  legend?: boolean;
  className?: string;
}

export function CairnStack({ stones, total = 1000, variant = 'stack', animate = false, legend = true, className }: Props) {
  const id = useId();
  const summary = cairnSummary(stones, total);
  const counted = stones.filter((s) => s.state !== 'requested');
  const asked = stones.filter((s) => s.state === 'requested');
  return (
    <figure className={`cairn cairn-${variant}${animate ? ' cairn-settle' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-cap`}>
      {variant === 'stack' ? <StackSvg counted={counted} asked={asked} total={total} /> : <RowSvg counted={counted} asked={asked} total={total} />}
      <figcaption id={`${id}-cap`} className={variant === 'row' ? 'cairn-cap-row' : 'cairn-cap'}>
        {summary}
      </figcaption>
      {legend && stones.length > 0 && (
        <ul className={variant === 'row' ? 'visually-hidden' : 'cairn-legend'}>
          {[...counted].reverse().concat(asked).map((s) => (
            <li key={s.id} className={`cairn-key cairn-key-${s.state}${s.mine ? ' cairn-key-mine' : ''}`}>
              <span className="cairn-swatch" aria-hidden="true" />
              <span className="cairn-key-name">{s.mine && s.label !== 'You' ? `${s.label} (you)` : s.label}</span>
              <span className="cairn-key-amount num">{fmt(s.amount)} DASH</span>
              <span className="cairn-key-state">{STATE_WORDS[s.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

const stoneClass = (s: Stone) => `stone stone-${s.state}${s.mine ? ' stone-mine' : ''}`;

function Check({ cx, cy }: { cx: number; cy: number }) {
  return <path className="stone-check" d={`M${cx - 6},${cy} l4.5,4.5 l8,-9`} />;
}

function StackSvg({ counted, asked, total }: { counted: readonly Stone[]; asked: readonly Stone[]; total: number }) {
  const W = 260;
  const H = 320;
  const gap = 5;
  const base = 232;
  const unit = (H - gap * 8) / total;
  let y = H;
  let filled = 0;
  const shapes = counted.map((s, i) => {
    const h = Math.max(18, s.amount * unit);
    const mid = (filled + s.amount / 2) / total;
    const r = rand(`${s.id}:x`);
    const w = base * (1 - 0.38 * mid) * (0.92 + r() * 0.1);
    const x = (W - w) / 2 + (r() - 0.5) * 14;
    y -= h;
    const shape = { s, x, y, w, h, i };
    y -= gap;
    filled += s.amount;
    return shape;
  });
  const openDash = Math.max(0, total - filled);
  const openH = Math.max(0, y);
  const openW = base * (1 - 0.38 * ((filled + openDash / 2) / total));
  return (
    <svg className="cairn-svg" viewBox={`0 0 ${W} ${H}`} role="presentation" aria-hidden="true" focusable="false">
      {openDash > 0 && openH > 8 && (
        <path className="stone-open" d={stonePath((W - openW) / 2, 2, openW, openH - 2, `open:${total}`)} />
      )}
      {asked.length > 0 && openH > 30 && (
        <g className="stone-asked-group">
          {asked.slice(0, 3).map((s, i) => {
            const h = Math.max(16, Math.min(s.amount * unit, (openH - 12) / Math.min(asked.length, 3) - 6));
            const w = openW * 0.62;
            const yy = openH - 6 - (i + 1) * (h + 6);
            return yy > 4 ? <path key={s.id} className={stoneClass(s)} d={stonePath((W - w) / 2, yy, w, h, s.id)} /> : null;
          })}
        </g>
      )}
      {shapes.map(({ s, x, y: sy, w, h, i }) => (
        <g key={s.id} className="stone-g" style={{ '--i': shapes.length - 1 - i } as CSSProperties}>
          <path className={stoneClass(s)} d={stonePath(x, sy, w, h, s.id)} />
          {(s.state === 'approved' || s.state === 'signed') && h >= 22 && <Check cx={x + w - 34} cy={sy + h / 2} />}
        </g>
      ))}
    </svg>
  );
}

function RowSvg({ counted, asked, total }: { counted: readonly Stone[]; asked: readonly Stone[]; total: number }) {
  const W = 400;
  const H = 26;
  const gap = 3;
  const unit = (W - gap * 8) / total;
  let x = 0;
  let filled = 0;
  const shapes = counted.map((s) => {
    const w = Math.max(10, s.amount * unit);
    const shape = { s, x, w };
    x += w + gap;
    filled += s.amount;
    return shape;
  });
  const open = Math.max(0, total - filled);
  return (
    <svg className="cairn-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="presentation" aria-hidden="true" focusable="false">
      {shapes.map(({ s, x: sx, w }) => (
        <path key={s.id} className={stoneClass(s)} d={stonePath(sx, 2, w, H - 4, s.id)} />
      ))}
      {open > 0 && x < W - 6 && <path className={asked.length ? 'stone-open stone-open-asked' : 'stone-open'} d={stonePath(x, 2, W - x, H - 4, `open:${total}`)} />}
    </svg>
  );
}
