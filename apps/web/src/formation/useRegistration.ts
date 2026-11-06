// Registration checks as React state: each linked ProTx hash looked up over DAPI and judged against the approvals, on every read.
import { fetchActivation } from '../data/activation.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import { errText } from '../lib/format.ts';
import type { Agreement } from '../matching/agreement.ts';
import type { GroupView } from '../matching/group.ts';
import { lookupRegistration } from './chain.ts';
import { judgeRegistration, type RegistrationJudgement } from './verify.ts';

export type RegState =
  | { status: 'idle' }
  | { status: 'checking'; progress: string }
  | { status: 'done'; results: RegistrationJudgement[] }
  | { status: 'error'; error: string };

/** The verified one if any, else the first: what a page shows as "the" registration. */
export const primaryOf = (results: readonly RegistrationJudgement[]): RegistrationJudgement | null => results.find((r) => r.state === 'verified') ?? results[0] ?? null;

type Lookup = Awaited<ReturnType<typeof lookupRegistration>>;
const RECENT_MS = 120_000;
const recent = new Map<string, { at: number; lookup: Promise<Lookup> }>();

/**
 * A registration's chain facts, shared for a couple of minutes, so moving between a group's pages does not prove the chain again.
 * `fresh` (a retry) always reads the chain.
 */
function lookupShared(registry: Registry, hash: string, onProgress: (m: string) => void, fresh: boolean): Promise<Lookup> {
  const key = `${registry.network}:${hash}`;
  const hit = recent.get(key);
  if (hit && !fresh && Date.now() - hit.at < RECENT_MS) return hit.lookup;
  const lookup = lookupRegistration(registry, hash, onProgress);
  recent.set(key, { at: Date.now(), lookup });
  lookup.catch(() => recent.delete(key));
  return lookup;
}

/** What judging a registration reads from an agreement: a reload that leaves these as they were need not check again. */
const agreementKey = (a: Agreement | null) => (a ? `${a.hash}|${a.anchored}|${a.problems.join('\n')}` : '');

export function useRegistrations(hashes: readonly string[], agreement: Agreement | null): { state: RegState; recheck(): void } {
  const { registry } = useApp();
  const [state, setState] = useState<RegState>({ status: 'idle' });
  const [tick, setTick] = useState(0);
  const recheck = useCallback(() => setTick((n) => n + 1), []);
  const key = hashes.join(',');
  const agreed = agreementKey(agreement);
  const latest = useRef(agreement);
  latest.current = agreement;
  useEffect(() => {
    const a = latest.current;
    if (!hashes.length || !a) return setState({ status: 'idle' });
    let live = true;
    setState((s) => (s.status === 'done' ? s : { status: 'checking', progress: 'Looking for the registration' }));
    // a re-check keeps showing the last verdict until the new one is in, so a page does not fall back to "checking"
    const progress = (p: string) => live && setState((s) => (s.status === 'done' ? s : { status: 'checking', progress: p }));
    (async () => {
      const results: RegistrationJudgement[] = [];
      for (const h of hashes) results.push(judgeRegistration(a, await lookupShared(registry, h, progress, tick > 0)));
      if (live) setState({ status: 'done', results });
    })().catch((e: unknown) => live && setState({ status: 'error', error: errText(e) }));
    return () => {
      live = false;
    };
  }, [registry, key, agreed, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, recheck };
}

export interface GroupRegistrations {
  state: RegState;
  recheck(): void;
  /** The registration the group stands for, once checked. */
  primary: RegistrationJudgement | null;
}

/** Every registration linked to a group, checked on chain against the group's approvals: what its pages show as its chain status. */
export function useGroupRegistrations(view: GroupView): GroupRegistrations {
  const hashes = useMemo(() => view.linked.map((x) => x.hash), [view.linked]);
  const { state, recheck } = useRegistrations(hashes, view.agreement);
  return { state, recheck, primary: state.status === 'done' ? primaryOf(state.results) : null };
}

/** One registration on demand (the link form checks before it writes). */
export function useRegistrationCheck(agreement: Agreement | null): { state: RegState; check(hash: string): void; reset(): void } {
  const { registry } = useApp();
  const [state, setState] = useState<RegState>({ status: 'idle' });
  const [run, setRun] = useState<{ hash: string; n: number } | null>(null);
  useEffect(() => {
    if (!run || !agreement) return;
    let live = true;
    setState({ status: 'checking', progress: 'Looking for the registration' });
    lookupRegistration(registry, run.hash, (progress) => live && setState({ status: 'checking', progress })).then(
      (lookup) => live && setState({ status: 'done', results: [judgeRegistration(agreement, lookup)] }),
      (e: unknown) => live && setState({ status: 'error', error: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [registry, run, agreement]);
  return {
    state,
    check: useCallback((hash: string) => setRun((r) => ({ hash, n: (r?.n ?? 0) + 1 })), []),
    reset: useCallback(() => (setRun(null), setState({ status: 'idle' })), []),
  };
}

/** Whether shared masternodes can be registered on this network now: testnet since block 1,578,000, mainnet per Radar. */
export function useV24Active(network: 'testnet' | 'mainnet'): boolean | null {
  const [active, setActive] = useState<boolean | null>(network === 'testnet' ? true : null);
  useEffect(() => {
    if (network === 'testnet') return setActive(true);
    const ac = new AbortController();
    fetchActivation(ac.signal).then((a) => setActive(a.active), () => setActive(null));
    return () => ac.abort();
  }, [network]);
  return active;
}
