// Names for everyone a page shows (roster, requests, operators): the proved DPNS username first, then the person's
// own display name (personName). Profiles come in batches through the proved `in` query; DPNS names one by one, a few at a time.
import { profilesOf, toProfile, type Profile } from '@cairn/contract';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import { dpnsName, queryCairn } from './platform.ts';
import { personName } from './profile.ts';

export interface Person {
  id: string;
  profile: Profile | null;
  dpns: string | null;
  /** What to call them; null when they have neither a username nor a profile name. */
  name: string | null;
}

const cache = new Map<string, Promise<Person>>();
const key = (r: Registry, id: string) => `${r.network}:${r.contractId}:${id}`;
const BATCH = 100;
const DPNS_AT_ONCE = 4;

async function limited<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!);
      }
    }),
  );
  return out;
}

function fetchPeople(r: Registry, ids: string[]): Map<string, Promise<Person>> {
  const profiles = (async () => {
    const out = new Map<string, Profile>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const res = await queryCairn(r, profilesOf(ids.slice(i, i + BATCH)));
      for (const d of res.docs) {
        try {
          const p = toProfile(d);
          out.set(p.ownerId, p);
        } catch {
          /* a malformed profile is no name */
        }
      }
    }
    return out;
  })();
  const names = limited(ids, DPNS_AT_ONCE, (id) => dpnsName(r, id).catch(() => null));
  return new Map(
    ids.map((id, i) => [
      id,
      Promise.all([profiles.catch(() => new Map<string, Profile>()), names]).then(([ps, ns]) => {
        const profile = ps.get(id) ?? null;
        const dpns = ns[i] ?? null;
        return { id, profile, dpns, name: personName(profile, dpns) };
      }),
    ]),
  );
}

export function loadPeople(r: Registry, ids: readonly string[]): Promise<Map<string, Person>> {
  const missing = [...new Set(ids)].filter((id) => !cache.has(key(r, id)));
  if (missing.length && r.contractId) for (const [id, p] of fetchPeople(r, missing)) cache.set(key(r, id), p);
  return Promise.all([...new Set(ids)].map((id) => cache.get(key(r, id)) ?? Promise.resolve({ id, profile: null, dpns: null, name: null }))).then((ps) => new Map(ps.map((p) => [p.id, p])));
}

/** Drops a cached person (after they saved their profile). */
export function forgetPerson(r: Registry, id: string): void {
  cache.delete(key(r, id));
}

/** People by id; empty until their names are read. */
export function usePeople(ids: readonly string[]): Map<string, Person> {
  const { registry } = useApp();
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const k = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  useEffect(() => {
    if (!k) return;
    let live = true;
    loadPeople(registry, k.split(',')).then((m) => live && setPeople(m), () => {});
    return () => {
      live = false;
    };
  }, [registry, k]);
  return people;
}
