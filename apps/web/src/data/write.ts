// Every matching write, the way /me saves a profile: signed by @cairn/auth's one document writer (which itself waits for a proved
// read of the result), then read back here with a proof and compared field by field through the contract's own reader. Only a
// document Platform proves to hold exactly what this page sent counts as saved.
import { DocError, READERS, toGroup, type DocOp, type DocType, type Network, type RawDoc } from '@cairn/contract';
import { useCallback } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import type { DocumentOp, DocumentResult } from '../session/session.ts';
import { readDoc, remember } from './cairn.ts';

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
  read(r: Registry, type: DocType, id: string): Promise<RawDoc | null>;
  sleep(ms: number): Promise<void>;
}
const DEFAULT_DEPS: WriteDeps = { read: readDoc, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) };
const TRIES = 6;

/** Writes `op` and proves the result: the stored document (null after a delete). Throws with a message fit to show. */
export async function writeConfirmed(r: Registry, write: (op: DocumentOp) => Promise<DocumentResult>, op: DocOp, deps: WriteDeps = DEFAULT_DEPS): Promise<RawDoc | null> {
  const done = await write(op);
  const id = done.id;
  if (op.action === 'delete') {
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
export function useWrite(): (op: DocOp | (() => DocOp)) => Promise<RawDoc | null> {
  const { registry } = useApp();
  const { write } = useAccount();
  return useCallback(
    async (op) => {
      let built: DocOp;
      try {
        built = typeof op === 'function' ? op() : op;
      } catch (e) {
        throw e instanceof DocError ? new Error(e.message) : e;
      }
      return writeConfirmed(registry, write, built);
    },
    [registry, write],
  );
}
