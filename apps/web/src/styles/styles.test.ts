// Every stylesheet is global, and the one loaded last wins. A class that two of Cairn's own stylesheets style at the top level is
// two components fighting over it: the formation `.facts` grid once broke every terms block's label/value pairs that way.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OWN = ['styles/app.css', 'styles/matching.css', 'formation/formation.css'];
/** Shared building blocks that app.css defines once and the others extend on purpose. */
const SHARED = new Set(['me-side']);

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** The classes a stylesheet's rules start with (`.facts dt, .x > .y` → facts, x), outside @keyframes. */
function rootClasses(css: string): Set<string> {
  const out = new Set<string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of body.matchAll(/([^{}@;]+)\{/g)) {
    for (const sel of m[1]!.split(',')) {
      const root = /^\s*\.([a-zA-Z][\w-]*)(?=[\s.:>+~[]|$)/.exec(sel.trim());
      if (root) out.add(root[1]!);
    }
  }
  return out;
}

describe('stylesheets', () => {
  it('finds the classes a rule starts with', () => {
    expect([...rootClasses('.a dt, .b > .c { x: 1 } @media (max-width: 1px) { .d:hover { y: 2 } } p .e { z: 3 }')]).toEqual(['a', 'b', 'd']);
  });

  it('no top-level class is styled by two of Cairn’s stylesheets', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of OWN)
      for (const c of rootClasses(read(file))) {
        const other = seen.get(c);
        if (other && other !== file && !SHARED.has(c)) clashes.push(`.${c}: ${other} and ${file}`);
        seen.set(c, file);
      }
    expect(clashes).toEqual([]);
  });
});
