// Display names, after govhub packages/forum/src/text.ts (D-035, commit fa04bea). Names never carry invisible or
// direction-changing characters (they can make one name look like another), and a name must not imitate the labels Cairn puts
// next to people itself. Writers refuse such names (nameProblem); readers clean what is already stored (cleanName, badgeLike).

/** Letters and marks that render as nothing (combining grapheme joiner, Hangul and Khmer fillers, Mongolian separator, braille blank). */
const BLANK_LETTERS = '\\u034F\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u2800\\u3164\\uFFA0';
const INVISIBLE = new RegExp(`[\\p{Cf}\\p{Cc}${BLANK_LETTERS}]`, 'gu');

const ZWJ = '‍';
const PICTO = /\p{Extended_Pictographic}/u;
/** Keeps a zero-width joiner between two pictographs (family and profession emoji); drops every other invisible character. */
const stripInvisible = (s: string): string =>
  s.replace(INVISIBLE, (ch: string, at: number) => {
    if (ch !== ZWJ) return '';
    const before = s.slice(0, at).replace(/[️\p{Emoji_Modifier}]+$/u, '');
    const prev = String.fromCodePoint(before.codePointAt(before.length - 1) ?? 0);
    const prevHigh = before.length >= 2 ? String.fromCodePoint(before.codePointAt(before.length - 2) ?? 0) : '';
    const next = String.fromCodePoint(s.codePointAt(at + 1) ?? 0);
    return (PICTO.test(prev) || PICTO.test(prevHigh)) && PICTO.test(next) ? ch : '';
  });

/** A display name as it may be shown: invisible characters removed (emoji joiners kept), runs of whitespace collapsed. */
export const cleanName = (s: string): string => stripInvisible(s).replace(/\s+/g, ' ').trim();

/** Words and marks Cairn itself puts next to people and groups. govhub's list without "masternode", which operators use in real names. */
const BADGE_WORDS = /(?<![a-z])(?:owner|verified|moderator|moderation|official|admin|cairn)(?![a-z])/i;
const CHECK_MARKS = /[√☑✓✔✅\u{1F5F8}\u{1F5F9}⮽]/u;
/** Cyrillic and Greek letters (and digits and symbols) that look like Latin ones, folded before the badge-word check. */
const CONFUSABLE_FROM = [...'аеорсухіјѕԁɡкмнтвиοναεικρτυχ03457@$'];
const CONFUSABLE_TO = 'aeopcyxijsdgkmhtbuovaeikptuxoeastas';
const CONFUSABLE = new Map(CONFUSABLE_FROM.map((c, i) => [c, CONFUSABLE_TO[i]!]));
const skeleton = (s: string): string =>
  [...cleanName(s).normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase()]
    .map((c) => CONFUSABLE.get(c) ?? c)
    .join('')
    .replace(/[_\-.\s]+/g, ' ');
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/** The name reads like a Cairn label or badge or a DPNS name: badge words (look-alikes folded), check marks, ".dash", mixed scripts. */
export const badgeLike = (name: string): boolean => {
  const n = cleanName(name).normalize('NFKC');
  const sk = skeleton(n); // a 1 can stand for an i or an l
  return BADGE_WORDS.test(sk.replace(/1/g, 'i')) || BADGE_WORDS.test(sk.replace(/1/g, 'l')) || CHECK_MARKS.test(n) || /\.dash$/i.test(n) || (LATIN.test(n) && LOOKALIKE_SCRIPT.test(n));
};

/** Why a display name is refused when written, or null. */
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (stripInvisible(t) !== t) return "A name can't contain invisible or text-direction characters.";
  if (!cleanName(t)) return 'Enter a name.';
  const n = t.normalize('NFKC');
  if (/\.dash$/i.test(n)) return 'A name can\'t end in ".dash": that reads as a Dash username, which Cairn shows only when Platform proves it.';
  if (LATIN.test(n) && LOOKALIKE_SCRIPT.test(n)) return "A name can't mix Latin letters with Cyrillic or Greek ones: they can imitate each other.";
  if (badgeLike(t)) return 'A name can\'t contain badge text such as "owner", "verified" or ✓: Cairn adds those labels itself.';
  return null;
}
