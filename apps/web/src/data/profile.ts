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

function load(r: Registry, id: string) {
  const key = `${r.network}:${r.contractId}:${id}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all([r.contractId ? readProfile(r, id).then((x) => x.profile) : Promise.resolve(null), dpnsName(r, id).catch(() => null)]).then(([profile, dpns]) => ({ profile, dpns }));
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Drops the cached profile (after a write) and tells every useProfile to read again. */
export function invalidateProfile(): void {
  cache.clear();
  for (const l of listeners) l();
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
