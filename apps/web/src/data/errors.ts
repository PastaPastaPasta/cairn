// What a failed read or write says to the user: plain words, with the SDK's or a node's own text kept for a disclosure (and a bug
// report). Errors Cairn itself raises are already written for people and pass through unchanged.
import { errorText, isTransientError } from '../auth/runtime.ts';
import { errText } from '../lib/format.ts';
import { UnconfirmedWrite } from './write.ts';

export interface PlainError {
  text: string;
  /** The technical text, when `text` is not it. */
  detail: string | null;
}

const STALE_REFUSED = /invalid revision|desired revision/i;
const BAD_ID = /invalid document id|string decoding error|invalid character .* at byte|identifier values must be base58|not a valid identifier/i;
const UNREACHABLE = /transport error|grpc|failed to call|all nodes failed|no node|deadline exceeded|timed? ?out|connection (?:refused|reset|closed)/i;
const TECHNICAL = /wasm|state transition|broadcast error|JS API|\bSome\(|code: '|violates the PV13|TypeError|ReferenceError|unexpected token|\bpanicked\b|0x[0-9a-f]{8}/i;

/** `what`: what was being reached ("Dash Platform", "the Dash network"). */
export function plainError(e: unknown, what = 'Dash Platform'): PlainError {
  const raw = errorText(e);
  const plain = (text: string): PlainError => ({ text, detail: raw && raw !== text ? raw : null });
  // the write went through; only reading it back failed, and "could not reach" would invite sending it again
  if (e instanceof UnconfirmedWrite && (UNREACHABLE.test(raw) || TECHNICAL.test(raw) || isTransientError(e)))
    return plain('Dash Platform accepted the change, but this page could not read it back yet. Reload in a minute before you change it again.');
  if (STALE_REFUSED.test(raw)) return plain('Someone changed this on Dash Platform after the page loaded it, so the change was refused. Reload the page, check the latest version, then try again.');
  if (BAD_ID.test(raw)) return plain('This link does not point to a Cairn record: the id in it is not valid. Check that the whole link was copied.');
  if (isTransientError(e) || UNREACHABLE.test(raw)) return plain(`Could not reach ${what} just now: the connection dropped or a node was too slow. Try again in a moment.`);
  if (TECHNICAL.test(raw) || !(e instanceof Error)) return plain(`${what} could not do this just now. Try again; if it keeps failing, the technical details help a bug report.`);
  return { text: errText(e), detail: null };
}
