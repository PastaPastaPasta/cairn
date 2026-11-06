// Every matching write, the way /me saves a profile: signed by @cairn/auth's one document writer (which itself waits for a proved
// read of the result), then read back here with a proof and compared field by field through the contract's own reader. Only a
// document Platform proves to hold exactly what this page sent counts as saved.
import { DocError, READERS, toGroup, type DocOp, type DocType, type Network, type RawDoc } from '@cairn/contract';
import { useCallback } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import type { DocumentOp, DocumentResult } from '../session/session.ts';
import { forget, readDoc, readStored, remember } from './cairn.ts';

type Readable = Exclude<DocType, 'vault'>;
const readerFor = (type: DocType, network: Network) => (raw: RawDoc) => (type === 'group' ? toGroup(raw, network) : READERS[type as Readable](raw));

const SYSTEM = ['$id', '$ownerId', '$revision', '$createdAt', '$updatedAt'] as const;

/** Whether a document read back holds exactly the data a write sent, as the app reads both (system fields from the stored one). */
export function holdsData(type: DocType, back: RawDoc, sent: Record<string, unknown>, network: Network): boolean {
  const read = readerFor(type, network);
  const system = Object.fromEntries(SYSTEM.filter((k) => back[k] !== undefined).map((k) => [k, back[k]]));
  try {
    return JSON.stringify(read(back)) === JSON.stringify(read({ ...sent, ...system } as RawDoc));
  } catch {
    return false;
  }
}

export interface WriteDeps {
  /** The read-back after a write (this tab's copy may stand in for a node that lags behind it). */
  read(r: Registry, type: DocType, id: string): Promise<RawDoc | null>;
  /** The pre-flight read: Platform's own answer only. */
  stored(r: Registry, type: DocType, id: string): Promise<RawDoc | null>;
  sleep(ms: number): Promise<void>;
}
const DEFAULT_DEPS: WriteDeps = { read: readDoc, stored: readStored, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) };
const TRIES = 6;

/** Platform accepted the write but its result could not be proved here; `id` is the document it wrote (it may well exist). */
export class UnconfirmedWrite extends Error {
  constructor(
    message: string,
    readonly id: string,
  ) {
    super(message);
    this.name = 'UnconfirmedWrite';
  }
}

export const STALE_TEXT = 'This changed since the page loaded, so nothing was sent and nothing was charged. The page now shows the latest version: check it, then try again.';

/** The page acted on a version that is no longer the stored one. Nothing was signed or sent: Platform would refuse it after charging. */
export class StaleWrite extends Error {
  constructor(message = STALE_TEXT) {
    super(message);
    this.name = 'StaleWrite';
  }
}

/** A replace or delete of a document that is gone, or that someone replaced after the page read it. */
async function preflight(r: Registry, op: DocOp, deps: WriteDeps): Promise<void> {
  if (op.action === 'create') return;
  // a node without the document may only be behind: ask once more (the SDK picks a node per request) before refusing
  const stored = (await deps.stored(r, op.type, op.id)) ?? (await deps.stored(r, op.type, op.id));
  // a stored revision below the page's is a node lagging behind, not a newer version: Platform decides
  if (!stored || (op.action === 'replace' && Number(stored.$revision ?? 1) > op.revision)) throw new StaleWrite();
}

export interface WriteOptions {
  /** Runs right before signing; throws (a StaleWrite) when the write would be refused or no longer means what the page showed. */
  check?(): Promise<void>;
}

/** Writes `op` and proves the result: the stored document (null after a delete). Throws with a message fit to show. */
export async function writeConfirmed(r: Registry, write: (op: DocumentOp) => Promise<DocumentResult>, op: DocOp, deps: WriteDeps = DEFAULT_DEPS, o: WriteOptions = {}): Promise<RawDoc | null> {
  await preflight(r, op, deps);
  await o.check?.();
  const done = await write(op);
  try {
    return await confirm(r, op, done, deps);
  } catch (e) {
    throw new UnconfirmedWrite(e instanceof Error ? e.message : String(e), done.id);
  }
}

async function confirm(r: Registry, op: DocOp, done: DocumentResult, deps: WriteDeps): Promise<RawDoc | null> {
  const id = done.id;
  if (op.action === 'delete') {
    // this tab's own copy must not stand in for the document Platform no longer has
    forget(r, op.type, id);
    for (let i = 0; i < TRIES; i++) {
      if (!(await deps.read(r, op.type, id))) {
        remember(r, op.type, id, null);
        return null;
      }
      await deps.sleep(2000);
    }
    throw new Error('Platform accepted the delete, but a node still shows the document. Reload in a minute.');
  }
  const want = done.revision ?? 1;
  let back: RawDoc | null = null;
  for (let i = 0; i < TRIES; i++) {
    back = await deps.read(r, op.type, id);
    if (back && Number(back.$revision ?? 1) >= want) break;
    await deps.sleep(2000);
  }
  if (!back || Number(back.$revision ?? 1) < want) throw new Error('Platform confirmed the change, but the node read now does not show it yet. Reload in a minute.');
  if (!holdsData(op.type, back, op.data, r.network)) throw new Error('Platform now holds a different version than this page sent (another tab or person may have changed it). Reload before you change it again.');
  remember(r, op.type, id, back);
  return back;
}

/** The signed-in identity's confirmed writer. A model's DocError (a limit the page should have caught) reads as plain text. */
export function useWrite(): (op: DocOp | (() => DocOp), o?: WriteOptions) => Promise<RawDoc | null> {
  const { registry } = useApp();
  const { write } = useAccount();
  return useCallback(
    async (op, o) => {
      let built: DocOp;
      try {
        built = typeof op === 'function' ? op() : op;
      } catch (e) {
        throw e instanceof DocError ? new Error(e.message) : e;
      }
      return writeConfirmed(registry, write, built, DEFAULT_DEPS, o);
    },
    [registry, write],
  );
}
