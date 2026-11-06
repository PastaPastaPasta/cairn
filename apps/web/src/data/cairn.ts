// Reads of the cairn contract for matching and agreeing: proved queries only (queryCairn / getCairnDoc), every document passed
// through the contract's reader (malformed ones are skipped), and a small memory of documents this tab wrote, so a node that lags
// behind a write can neither undo it on screen nor hide a document just created.
import {
  approvalsOf, approvalsOfGroup, invitesOfGroup, opAcceptsOfGroup, seatsOfGroup, toApproval, toGroup, toInvite, toOpAccept, toSeat,
  type CairnQuery, type DocMeta, type DocType, type Network, type RawDoc,
} from '@cairn/contract';
import { base58 } from '@scure/base';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { plainError } from './errors.ts';
import type { Registry } from '../config/registry.ts';
import type { GroupBundle } from '../matching/group.ts';
import { getCairnDoc, isIdentifier, queryCairn } from './platform.ts';

export type Reader<T> = (raw: RawDoc, network: Network) => T;

// ---- what this tab wrote ---------------------------------------------------------------------------------------------------

const known = new Map<string, RawDoc | null>();
const knownKey = (r: Registry, type: DocType, id: string) => `${r.network}:${r.contractId}:${type}:${id}`;
const revOf = (raw: RawDoc) => Number(raw.$revision ?? 1);

/** A string identifier from a raw document field (evo-sdk JSON gives base58; a write's data gives bytes). */
export function rawId(raw: RawDoc, key: string): string | null {
  const v = raw[key];
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array && v.length === 32) return base58.encode(v);
  return null;
}

/** Remembers a document as read back after a write (null: deleted). */
export function remember(r: Registry, type: DocType, id: string, raw: RawDoc | null): void {
  known.set(knownKey(r, type, id), raw);
}

/** Forgets what this tab wrote of a document, so the next read is Platform's alone. */
export function forget(r: Registry, type: DocType, id: string): void {
  known.delete(knownKey(r, type, id));
}

/** Documents of `type` this tab wrote that a query should have returned (`belongs`), newest known version of each. */
export function withKnown(r: Registry, type: DocType, docs: RawDoc[], belongs: (raw: RawDoc) => boolean): RawDoc[] {
  const prefix = `${r.network}:${r.contractId}:${type}:`;
  const seen = new Set<string>();
  const out: RawDoc[] = [];
  for (const d of docs) {
    const id = rawId(d, '$id');
    if (!id) continue;
    seen.add(id);
    const k = known.get(prefix + id);
    if (k === null) continue;
    out.push(k && revOf(k) > revOf(d) ? k : d);
  }
  for (const [key, raw] of known) {
    if (!raw || !key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!seen.has(id) && belongs(raw)) out.push(raw);
  }
  return out;
}

export function readEach<T>(docs: RawDoc[], read: Reader<T>, network: Network): T[] {
  return docs.flatMap((d) => {
    try {
      return [read(d, network)];
    } catch {
      return [];
    }
  });
}

// ---- reads ------------------------------------------------------------------------------------------------------------------

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

/** Every page of an ascending query (startAfter paging), merged with what this tab wrote. */
export async function readAll<T extends DocMeta>(r: Registry, type: DocType, page: (startAfter?: string) => CairnQuery, read: Reader<T>, belongs: (raw: RawDoc) => boolean): Promise<T[]> {
  const docs: RawDoc[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = page(after);
    const res = await queryCairn(r, q);
    docs.push(...res.docs);
    const last = res.docs.at(-1);
    if (res.docs.length < (q.limit ?? 100) || !last) break;
    after = rawId(last, '$id') ?? undefined;
  }
  return readEach(withKnown(r, type, docs, belongs), read, r.network);
}

/** One newest-first page per status; `before` pages back by `$updatedAt` (documents at that exact time are re-read, then deduplicated). */
export async function readNewest<T extends DocMeta>(r: Registry, type: DocType, q: CairnQuery, read: Reader<T>, belongs: (raw: RawDoc) => boolean): Promise<{ items: T[]; more: boolean }> {
  const res = await queryCairn(r, q);
  return { items: readEach(withKnown(r, type, res.docs, belongs), read, r.network), more: res.docs.length >= (q.limit ?? 100) };
}

/** One proved document, or the version this tab wrote when it is newer. */
export async function readDoc(r: Registry, type: DocType, id: string): Promise<RawDoc | null> {
  const k = known.get(knownKey(r, type, id));
  if (k === null) return null;
  const raw = await getCairnDoc(r, type, id);
  if (k && (!raw || revOf(k) > revOf(raw))) return k;
  return raw;
}

/** What Platform holds (proved), never this tab's copy: a document deleted elsewhere reads as gone. Only a delete this tab confirmed is known. */
export async function readStored(r: Registry, type: DocType, id: string): Promise<RawDoc | null> {
  if (known.get(knownKey(r, type, id)) === null) return null;
  return getCairnDoc(r, type, id);
}

const ofGroup = (groupId: string) => (raw: RawDoc) => rawId(raw, 'groupId') === groupId;

export class GroupUnreadable extends Error {}

/**
 * A group with everything its pages need (the group, form and live pages, /check, /me and the operator track record): seats, the
 * operator's answer, invites, approvals for this terms revision and the one before.
 */
export async function loadGroupBundle(r: Registry, groupId: string): Promise<GroupBundle | null> {
  if (!isIdentifier(groupId)) return null;
  const belongs = ofGroup(groupId);
  // all at once: none of these needs the group first, so a slow node costs one round trip, not two
  const [raw, seats, opAccepts, invites, allApprovals] = await Promise.all([
    readDoc(r, 'group', groupId),
    readAll(r, 'seat', (a) => seatsOfGroup(groupId, a), toSeat, belongs),
    readAll(r, 'opAccept', (a) => opAcceptsOfGroup(groupId, a), toOpAccept, belongs),
    readAll(r, 'invite', (a) => invitesOfGroup(groupId, a), (d) => toInvite(d), belongs),
    readAll(r, 'approval', (a) => approvalsOfGroup(groupId, a), (d) => toApproval(d), belongs),
  ]);
  if (!raw) return null;
  let group;
  try {
    group = toGroup(raw, r.network);
  } catch (e) {
    throw new GroupUnreadable(`This group’s record breaks Dash Core’s share rules, so Cairn will not show it as terms (${(e as Error).message}).`);
  }
  const rev = group.termsRevision;
  // every revision in one ascending read; one so long that the read stopped early may lack the newest, so ask for those directly
  const capped = allApprovals.length >= MAX_PAGES * PAGE_SIZE;
  const atRevision = (n: number) =>
    capped
      ? readAll(r, 'approval', (a) => approvalsOf(groupId, n, a), (d) => toApproval(d), (d) => belongs(d) && Number(d.revision) === n)
      : Promise.resolve(allApprovals.filter((a) => a.termsRevision === n));
  const [approvals, voided] = await Promise.all([atRevision(rev), rev > 1 ? atRevision(rev - 1) : Promise.resolve([])]);
  return { group, seats, opAccepts, invites, approvals, voided };
}

// ---- a load as React state ---------------------------------------------------------------------------------------------------

export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string; detail?: string | null }
  | { status: 'ready'; data: T; refreshing: boolean };

/**
 * How a page left open notices that someone else changed what it shows: `version` reads a cheap token (a document's revision), and
 * a token other than the shown data's (`of`) re-reads everything.
 */
export interface Watch<T> {
  version(r: Registry): Promise<string>;
  of(data: T): string;
  /** Whether a read version is newer than the shown one (a node lagging behind the shown data is not a change). */
  newer(read: string, shown: string): boolean;
}

export const WATCH_EVERY_MS = 30_000;

/**
 * Runs `load` for `key` (null: nothing to load) and again on reload(). A reload keeps showing the last data while it reads, so a
 * page does not flash back to a spinner after every write. With `watch`, a visible page checks for changes every half minute and
 * whenever it regains focus; `updated` says a re-read was caused by someone else's change.
 */
export function useLoad<T>(key: string | null, load: (r: Registry) => Promise<T>, watch?: Watch<T>): Load<T> & { reload(): void; updated: boolean } {
  const { registry } = useApp();
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [updated, setUpdated] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (key === null || !registry.contractId) return;
    let live = true;
    const fresh = lastKey.current !== key;
    lastKey.current = key;
    if (fresh) setUpdated(false);
    setState((s) => (fresh || s.status !== 'ready' ? { status: 'loading' } : { ...s, refreshing: true }));
    loadRef.current(registry).then(
      (data) => live && setState({ status: 'ready', data, refreshing: false }),
      (e: unknown) => {
        if (!live) return;
        const p = e instanceof GroupUnreadable ? { text: e.message, detail: null } : plainError(e);
        setState({ status: 'error', error: p.text, detail: p.detail });
      },
    );
    return () => {
      live = false;
    };
  }, [registry, key, tick]);
  const refetch = useCallback(() => setTick((n) => n + 1), []);
  const reload = useCallback(() => {
    setUpdated(false);
    refetch();
  }, [refetch]);
  const shown = state.status === 'ready' && !state.refreshing ? state.data : undefined;
  const watching = !!watch && shown !== undefined;
  useEffect(() => {
    const w = watchRef.current;
    if (!watching || !w) return;
    let live = true;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const v = await w.version(registry);
        if (live && w.newer(v, w.of(shown as T))) {
          setUpdated(true);
          refetch();
        }
      } catch {
        // a failed check changes nothing on the page; the next one tries again
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, WATCH_EVERY_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [watching, shown, registry, refetch]);
  return { ...state, reload, updated };
}

const groupWatch = (groupId: string): Watch<GroupBundle | null> => ({
  version: async (r) => String((await readDoc(r, 'group', groupId))?.$revision ?? 0),
  of: (b) => String(b?.group.docRevision ?? 0),
  // a group that disappears (0) is a change too; a lower revision is a lagging node
  newer: (read, shown) => (read === '0' ? shown !== '0' : Number(read) > Number(shown)),
});

/** A group's bundle as React state (null: no such group), re-read on reload() and when the group changes while the page is open. */
export const useGroupBundle = (groupId: string) => useLoad(`group:${groupId}`, (r) => loadGroupBundle(r, groupId), groupWatch(groupId));

/** The identity's one document of a type unique per owner (looking post, operator listing), or the newer version this tab wrote. */
export async function readOwn<T>(r: Registry, type: DocType, query: CairnQuery, ownerId: string, read: Reader<T>): Promise<T | null> {
  const res = await queryCairn(r, query);
  return readEach(withKnown(r, type, res.docs, (raw) => rawId(raw, '$ownerId') === ownerId), read, r.network)[0] ?? null;
}
