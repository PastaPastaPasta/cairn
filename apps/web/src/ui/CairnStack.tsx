// The cairn: a group's progress to 1000 DASH as stacked stones. Each share is a stone sized by its amount and filled by its state,
// the same on every page (StoneKey): asking is dashed ochre, in is pale lichen, approved is lichen with a check, signed is dark
// lichen, and a closed group's stones are hatched granite. Seats people ask for sit on top of the stack, and what is still open is
// a ghost stone sized by the remainder. The drawing is decorative (aria-hidden); the caption and the list under it say the same in
// words, so nothing depends on colour or shape alone.
import { useId, type CSSProperties, type ReactNode } from 'react';

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

/** What the drawing shows, bottom up: counted shares, then the asks that fit in what is open, then the open remainder. */
export function cairnLayout(stones: readonly Stone[], total: number) {
  const counted = stones.filter((s) => s.state !== 'requested');
  let room = Math.max(0, total - counted.reduce((a, s) => a + s.amount, 0));
  const asked: Stone[] = [];
  for (const s of stones.filter((x) => x.state === 'requested')) {
    if (room <= 0) break;
    const amount = Math.min(s.amount, room);
    asked.push({ ...s, amount });
    room -= amount;
  }
  return { counted, asked, open: room };
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
  /** A closed or dissolved group: every stone hatched granite. */
  closed?: boolean;
  /** Replaces the summary under the drawing. */
  caption?: ReactNode;
  className?: string;
}

export function CairnStack({ stones, total = 1000, variant = 'stack', animate = false, legend = true, closed = false, caption, className }: Props) {
  const id = useId();
  const layout = cairnLayout(stones, total);
  const asked = stones.filter((s) => s.state === 'requested');
  const cls = ['cairn', `cairn-${variant}`, animate && 'cairn-settle', closed && 'cairn-closed', className].filter(Boolean).join(' ');
  return (
    <figure className={cls} aria-labelledby={`${id}-cap`}>
      {variant === 'stack' ? <StackSvg {...layout} total={total} closed={closed} /> : <RowSvg {...layout} total={total} closed={closed} />}
      <figcaption id={`${id}-cap`} className={variant === 'row' ? 'cairn-cap-row' : 'cairn-cap'}>
        {caption ?? cairnSummary(stones, total)}
      </figcaption>
      {legend && stones.length > 0 && (
        <ul className={variant === 'row' ? 'visually-hidden' : 'cairn-legend'}>
          {variant === 'stack' && layout.open > 0 && (
            <li className="cairn-key cairn-key-open">
              <span className="cairn-swatch" aria-hidden="true" />
              <span className="cairn-key-name">Open</span>
              <span className="cairn-key-amount num">{fmt(layout.open)} DASH</span>
              <span className="cairn-key-state">still open</span>
            </li>
          )}
          {[...asked].reverse().concat([...layout.counted].reverse()).map((s) => (
            <li key={s.id} className={`cairn-key cairn-key-${s.state}${s.mine ? ' cairn-key-mine' : ''}`}>
              <span className="cairn-swatch" aria-hidden="true" />
              <span className="cairn-key-name" title={s.label}>
                {s.mine && s.label !== 'You' ? `${s.label} (you)` : s.label}
              </span>
              <span className="cairn-key-amount num">{fmt(s.amount)} DASH</span>
              <span className="cairn-key-state">{s.mine && s.state === 'requested' ? 'asking for a seat' : STATE_WORDS[s.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** The stone colours in words, once per page that shows stones without their own legend. */
export function StoneKey({ closed = false }: { closed?: boolean }) {
  const keys = [
    ['requested', 'asking'],
    ['in', 'in'],
    ['approved', 'approved the terms'],
    ['signed', 'signed in Dash Core'],
    ...(closed ? [['closed', 'closed']] : []),
  ] as const;
  return (
    <ul className="stone-key small" aria-label="What the stone colours mean">
      {keys.map(([k, words]) => (
        <li key={k} className={`cairn-key-${k}`}>
          <span className="cairn-swatch" aria-hidden="true" />
          {words}
        </li>
      ))}
    </ul>
  );
}

const stoneClass = (s: Stone) => `stone stone-${s.state}${s.mine ? ' stone-mine' : ''}`;

function Check({ cx, cy }: { cx: number; cy: number }) {
  return <path className="stone-check" d={`M${cx - 6},${cy} l4.5,4.5 l8,-9`} />;
}

type Layout = ReturnType<typeof cairnLayout>;

function StackSvg({ counted, asked, open, total, closed }: Layout & { total: number; closed: boolean }) {
  const hatch = useHatch(closed);
  const W = 260;
  const H = 320;
  const gap = 5;
  // an ask hovers a little higher than a placed stone: it is not part of the cairn yet
  const lift = 9;
  const base = 232;
  const unit = (H - gap * 8 - lift) / total;
  let y = H;
  let filled = 0;
  const place = (s: Stone, i: number, above: number) => {
    const h = Math.max(18, s.amount * unit);
    const mid = (filled + s.amount / 2) / total;
    const r = rand(`${s.id}:x`);
    const w = base * (1 - 0.38 * mid) * (0.92 + r() * 0.1);
    const x = (W - w) / 2 + (r() - 0.5) * 14;
    y -= h + above;
    filled += s.amount;
    return { s, x, y, w, h, i };
  };
  const shapes = counted.map((s, i) => place(s, i, i === 0 ? 0 : gap));
  const asks = asked.map((s, i) => place(s, i, i === 0 && shapes.length ? lift : gap));
  const openH = y - gap - 2;
  const openW = base * (1 - 0.38 * ((filled + open / 2) / total));
  return (
    <svg className="cairn-svg" viewBox={`0 0 ${W} ${H}`} role="presentation" aria-hidden="true" focusable="false">
      {hatch.defs}
      {open > 0 && openH > 8 && (
        <g className="stone-open-g">
          <path className="stone-open" d={stonePath((W - openW) / 2, 2, openW, openH, `open:${total}`)} />
          {openH >= 24 && (
            <text className="stone-open-label" x={W / 2} y={2 + openH / 2} textAnchor="middle" dominantBaseline="central">
              {fmt(open)} open
            </text>
          )}
        </g>
      )}
      {asks.length > 0 && (
        <g className="stone-asked-group">
          {asks.map(({ s, x, y: sy, w, h }) => (
            <path key={s.id} className={stoneClass(s)} d={stonePath(x, sy, w, h, s.id)} />
          ))}
        </g>
      )}
      {shapes.map(({ s, x, y: sy, w, h, i }) => (
        <g key={s.id} className="stone-g" style={{ '--i': shapes.length - 1 - i } as CSSProperties}>
          <path className={stoneClass(s)} d={stonePath(x, sy, w, h, s.id)} style={hatch.fill} />
          {(s.state === 'approved' || s.state === 'signed') && h >= 22 && <Check cx={x + w - 34} cy={sy + h / 2} />}
        </g>
      ))}
    </svg>
  );
}

/** A closed group's stones are hatched granite. Pattern ids are per drawing: several cairns share a page. */
function useHatch(closed: boolean) {
  const id = `hatch-${useId().replace(/[^\w-]/g, '')}`;
  const defs = closed ? (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" className="stone-hatch-bg" />
        <path d="M0 0v6" className="stone-hatch-line" />
      </pattern>
    </defs>
  ) : null;
  // the class rules set every stone's fill, so the pattern goes on as a style, which outranks them
  const fill: CSSProperties | undefined = closed ? { fill: `url("#${id}")` } : undefined;
  return { defs, fill };
}

function RowSvg({ counted, open, total, closed }: Layout & { total: number; closed: boolean }) {
  const hatch = useHatch(closed);
  const W = 400;
  const H = 26;
  const gap = 3;
  const unit = (W - gap * 8) / total;
  let x = 0;
  const shapes = counted.map((s) => {
    const w = Math.max(10, s.amount * unit);
    const shape = { s, x, w };
    x += w + gap;
    return shape;
  });
  const rest = Math.max(0, total - counted.reduce((a, s) => a + s.amount, 0));
  return (
    <svg className="cairn-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="presentation" aria-hidden="true" focusable="false">
      {hatch.defs}
      {shapes.map(({ s, x: sx, w }) => (
        <path key={s.id} className={stoneClass(s)} d={stonePath(sx, 2, w, H - 4, s.id)} style={hatch.fill} />
      ))}
      {rest > 0 && x < W - 6 && <path className={open < rest ? 'stone-open stone-open-asked' : 'stone-open'} d={stonePath(x, 2, W - x, H - 4, `open:${total}`)} />}
    </svg>
  );
}
