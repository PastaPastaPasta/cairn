// Reads of the cairn contract for matching and agreeing: proved queries only (queryCairn / getCairnDoc), every document passed
// through the contract's reader (malformed ones are skipped), and a small memory of documents this tab wrote, so a node that lags
// behind a write can neither undo it on screen nor hide a document just created.
import {
  approvalsOf, invitesOfGroup, opAcceptsOfGroup, seatsOfGroup, toApproval, toGroup, toInvite, toOpAccept, toSeat,
  type CairnQuery, type DocMeta, type DocType, type Network, type RawDoc,
} from '@cairn/contract';
import { base58 } from '@scure/base';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { plainErrorText } from '../auth/runtime.ts';
import type { Registry } from '../config/registry.ts';
import type { GroupBundle } from '../matching/group.ts';
import { getCairnDoc, queryCairn } from './platform.ts';

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

const ofGroup = (groupId: string) => (raw: RawDoc) => rawId(raw, 'groupId') === groupId;

export class GroupUnreadable extends Error {}

/** A group with everything its page needs: seats, the operator's answer, invites, approvals for this revision and the one before. */
export async function loadGroupBundle(r: Registry, groupId: string): Promise<GroupBundle | null> {
  const raw = await readDoc(r, 'group', groupId);
  if (!raw) return null;
  let group;
  try {
    group = toGroup(raw, r.network);
  } catch (e) {
    throw new GroupUnreadable(`This group’s record breaks Dash Core’s share rules, so Cairn will not show it as terms (${(e as Error).message}).`);
  }
  const belongs = ofGroup(groupId);
  const sameRevision = (rev: number) => (d: RawDoc) => belongs(d) && Number(d.revision) === rev;
  const [seats, opAccepts, invites, approvals, voided] = await Promise.all([
    readAll(r, 'seat', (a) => seatsOfGroup(groupId, a), toSeat, belongs),
    readAll(r, 'opAccept', (a) => opAcceptsOfGroup(groupId, a), toOpAccept, belongs),
    readAll(r, 'invite', (a) => invitesOfGroup(groupId, a), (d) => toInvite(d), belongs),
    readAll(r, 'approval', (a) => approvalsOf(groupId, group.revision, a), (d) => toApproval(d), sameRevision(group.revision)),
    group.revision > 1 ? readAll(r, 'approval', (a) => approvalsOf(groupId, group.revision - 1, a), (d) => toApproval(d), sameRevision(group.revision - 1)) : Promise.resolve([]),
  ]);
  return { group, docRevision: revOf(raw), seats, opAccepts, invites, approvals, voided };
}

// ---- a load as React state ---------------------------------------------------------------------------------------------------

export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T; refreshing: boolean };

/**
 * Runs `load` for `key` (null: nothing to load) and again on reload(). A reload keeps showing the last data while it reads, so a
 * page does not flash back to a spinner after every write.
 */
export function useLoad<T>(key: string | null, load: (r: Registry) => Promise<T>): Load<T> & { reload(): void } {
  const { registry } = useApp();
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (key === null || !registry.contractId) return;
    let live = true;
    const fresh = lastKey.current !== key;
    lastKey.current = key;
    setState((s) => (fresh || s.status !== 'ready' ? { status: 'loading' } : { ...s, refreshing: true }));
    loadRef.current(registry).then(
      (data) => live && setState({ status: 'ready', data, refreshing: false }),
      (e: unknown) => live && setState({ status: 'error', error: e instanceof GroupUnreadable ? e.message : plainErrorText(e, 'Dash Platform') }),
    );
    return () => {
      live = false;
    };
  }, [registry, key, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
