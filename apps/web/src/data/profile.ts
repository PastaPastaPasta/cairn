// The signed-in identity's profile and DPNS name, read with proofs. One cache per page load, refreshed after a save.
import { profileOf, toProfile, type Profile } from '@cairn/contract';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import { dpnsName, queryCairn } from './platform.ts';

export async function readProfile(r: Registry, identityId: string): Promise<{ profile: Profile | null; height: number | null }> {
  const res = await queryCairn(r, profileOf(identityId));
  const raw = res.docs[0];
  return { profile: raw ? toProfile(raw) : null, height: res.height };
}

const cache = new Map<string, Promise<{ profile: Profile | null; dpns: string | null }>>();
const listeners = new Set<() => void>();
const cacheKey = (r: Registry, id: string) => `${r.network}:${r.contractId}:${id}`;

function load(r: Registry, id: string) {
  const key = cacheKey(r, id);
  let p = cache.get(key);
  if (!p) {
    p = Promise.all([r.contractId ? readProfile(r, id).then((x) => x.profile) : Promise.resolve(null), dpnsName(r, id).catch(() => null)]).then(([profile, dpns]) => ({ profile, dpns }));
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/**
 * Replaces the cached profile with one read back after a write, and tells every useProfile. Not a re-read: another node may still
 * lag behind the write and would hand the form an old revision.
 */
export function seedProfile(r: Registry, id: string, profile: Profile): void {
  const key = cacheKey(r, id);
  const prev = cache.get(key) ?? Promise.resolve({ profile: null, dpns: null });
  cache.set(key, prev.catch(() => ({ profile: null, dpns: null })).then(({ dpns }) => ({ profile, dpns })));
  for (const l of listeners) l();
}

/** How a person is named: the proved Dash username first, else their own display name, in quotes when it imitates a label. */
export function personName(profile: Profile | null, dpns: string | null): string | null {
  if (dpns) return dpns;
  if (!profile?.displayName) return null;
  return profile.nameSuspect ? `“${profile.displayName}”` : profile.displayName;
}

export function useProfile(identityId: string | null): { profile: Profile | null; dpns: string | null; loading: boolean; error: string | null } {
  const { registry } = useApp();
  const [state, setState] = useState<{ profile: Profile | null; dpns: string | null; loading: boolean; error: string | null }>({ profile: null, dpns: null, loading: !!identityId, error: null });
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    listeners.add(bump);
    return () => void listeners.delete(bump);
  }, [bump]);
  useEffect(() => {
    if (!identityId) return setState({ profile: null, dpns: null, loading: false, error: null });
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load(registry, identityId).then(
      (v) => live && setState({ ...v, loading: false, error: null }),
      (e: unknown) => live && setState({ profile: null, dpns: null, loading: false, error: String((e as Error)?.message ?? e) }),
    );
    return () => {
      live = false;
    };
  }, [registry, identityId, tick]);
  return state;
}
