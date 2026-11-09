// Every stylesheet is global, and the one loaded last wins. A class that two stylesheets style at the top level is two
// components fighting over it: the formation `.facts` grid once broke every terms block's label/value pairs that way. And an
// unclosed rule silently nests every rule after it, so they never match: a merge once dropped one `}` and the Live page lost
// its reading column.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every stylesheet the app loads (main.tsx, formation/ui.tsx and the matching pages). */
const SHEETS = ['styles/tokens.css', 'styles/govhub-auth.css', 'styles/app.css', 'styles/matching.css', 'formation/formation.css'];
/** Shared building blocks that one sheet defines and another extends on purpose. */
const SHARED = new Set(['me-side']);
/** govhub-auth.css is vendored unchanged (VENDORED.md); app.css restyles these of its classes for Cairn on purpose. */
const VENDORED_OVERRIDES = new Set([
  'account-name',
  'btn',
  'btn-l',
  'btn-primary',
  'btn-quiet',
  'btn-s',
  'form',
  'form-actions',
  'main',
  'notice-box',
  'tag',
  'wordmark',
]);
/** `file :: context :: selector` of rules a sheet repeats on purpose. */
const REPEATED: ReadonlySet<string> = new Set();

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

interface CssRule {
  selector: string;
  /** The enclosing at-rule preludes, outermost first, e.g. `@media (max-width: 40rem)`. */
  context: string[];
  line: number;
}

/** Each style rule with the at-rules around it, plus structural errors. Skips comments and strings; not a full CSS parser. */
function outline(css: string): { rules: CssRule[]; errors: string[] } {
  const rules: CssRule[] = [];
  const errors: string[] = [];
  const stack: { prelude: string; line: number }[] = [];
  const isAt = (b: { prelude: string }) => b.prelude.startsWith('@');
  let buf = '';
  let bufLine = 1;
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) errors.push(`line ${line}: comment never closed`);
      const stop = end < 0 ? css.length : end + 2;
      line += css.slice(i, stop).split('\n').length - 1;
      i = stop - 1;
      continue;
    }
    if (ch === '\n') line++;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      buf += css.slice(i, j + 1);
      i = j;
    } else if (ch === '{') {
      const block = { prelude: buf.replace(/\s+/g, ' ').trim(), line: bufLine };
      const parent = stack.at(-1);
      if (parent && !isAt(parent) && !isAt(block))
        errors.push(`line ${block.line}: "${block.prelude}" is nested inside "${parent.prelude}" (line ${parent.line}); is a } missing?`);
      stack.push(block);
      buf = '';
    } else if (ch === '}') {
      const block = stack.pop();
      if (!block) errors.push(`line ${line}: } without a matching {`);
      else if (!isAt(block) && !stack.some((b) => /^@(-\w+-)?keyframes\b/.test(b.prelude)))
        rules.push({ selector: block.prelude, context: stack.map((b) => b.prelude), line: block.line });
      buf = '';
    } else if (ch === ';') buf = '';
    else {
      if (!buf.trim()) bufLine = line;
      buf += ch;
    }
  }
  for (const b of stack) errors.push(`line ${b.line}: "${b.prelude}" is never closed`);
  return { rules, errors };
}

/** The selectors of a list, split at its top-level commas only (`:is(.a, .b) p, .c` → `:is(.a, .b) p`, `.c`). */
function selectorList(selector: string): string[] {
  const out = [''];
  let depth = 0;
  for (const ch of selector) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) out.push('');
    else out[out.length - 1] += ch;
  }
  return out;
}

/** The classes a rule's selectors start with (`.facts dt, .x > .y` → facts, x; `:is(.a, .b) p` → a, b). A selector that starts with
 *  `:where(…)` is a zero-specificity default that any sheet overrides, so it claims no class. */
const rootClasses = (selector: string): string[] =>
  selectorList(selector).flatMap((sel) => {
    const s = sel.trim();
    if (s.startsWith(':where(')) return [];
    const is = /^:is\(([^()]*)\)/.exec(s);
    if (is) return rootClasses(is[1]!);
    return /^\.([a-zA-Z][\w-]*)(?=[\s.:>+~[]|$)/.exec(s)?.[1] ?? [];
  });

describe('stylesheets', () => {
  it('reads rules, their at-rules and structural errors', () => {
    const ok = outline('/* { */ .a dt, .b > .c { content: "}"; } @media (max-width: 1px) { .d:hover { y: 2 } } @keyframes k { to { z: 3 } } :where(.e, .f) > p, .g { w: 4 } :is(.h, .i) p { v: 5 }');
    expect(ok.errors).toEqual([]);
    expect(ok.rules.map((r) => [r.selector, r.context])).toEqual([
      ['.a dt, .b > .c', []],
      ['.d:hover', ['@media (max-width: 1px)']],
      [':where(.e, .f) > p, .g', []],
      [':is(.h, .i) p', []],
    ]);
    expect(ok.rules.flatMap((r) => rootClasses(r.selector))).toEqual(['a', 'b', 'd', 'g', 'h', 'i']);
    expect(outline('.a {\n  color: red;\n.b { x: 1 }').errors).toEqual([
      'line 3: ".b" is nested inside ".a" (line 1); is a } missing?',
      'line 1: ".a" is never closed',
    ]);
    expect(outline('.a { x: 1 } }').errors).toEqual(['line 1: } without a matching {']);
  });

  it.each(SHEETS)('%s is well formed: balanced braces, no nested rules', (file) => {
    expect(outline(read(file)).errors).toEqual([]);
  });

  it.each(SHEETS)('%s does not repeat a rule in the same place', (file) => {
    const seen = new Map<string, number>();
    const repeats: string[] = [];
    for (const r of outline(read(file)).rules) {
      const key = `${file} :: ${r.context.join(' ')} :: ${r.selector}`;
      const first = seen.get(key);
      if (first !== undefined && !REPEATED.has(key)) repeats.push(`${key} (lines ${first} and ${r.line})`);
      seen.set(key, first ?? r.line);
    }
    expect(repeats).toEqual([]);
  });

  it('no top-level class is styled by two stylesheets, beyond the listed exceptions', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    const vendored = new Set<string>();
    for (const file of SHEETS)
      for (const c of new Set(outline(read(file)).rules.flatMap((r) => rootClasses(r.selector)))) {
        const other = seen.get(c);
        if (other && other !== file) {
          if (other === 'styles/govhub-auth.css' && VENDORED_OVERRIDES.has(c)) vendored.add(c);
          else if (!SHARED.has(c)) clashes.push(`.${c}: ${other} and ${file}`);
        }
        seen.set(c, file);
      }
    expect(clashes).toEqual([]);
    expect([...vendored].sort()).toEqual([...VENDORED_OVERRIDES].sort());
  });
});
