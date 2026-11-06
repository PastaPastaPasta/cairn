// Registration checks as React state: each linked ProTx hash looked up over DAPI and judged against the approvals, on every read.
import { fetchActivation } from '../data/activation.ts';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { errText } from '../lib/format.ts';
import { lookupRegistration } from './chain.ts';
import type { Agreement } from './data.ts';
import { judgeRegistration, type RegistrationJudgement } from './verify.ts';

export type RegState =
  | { status: 'idle' }
  | { status: 'checking'; progress: string }
  | { status: 'done'; results: RegistrationJudgement[] }
  | { status: 'error'; error: string };

/** The verified one if any, else the first: what a page shows as "the" registration. */
export const primaryOf = (results: readonly RegistrationJudgement[]): RegistrationJudgement | null => results.find((r) => r.state === 'verified') ?? results[0] ?? null;

export function useRegistrations(hashes: readonly string[], agreement: Agreement | null): { state: RegState; recheck(): void } {
  const { registry } = useApp();
  const [state, setState] = useState<RegState>({ status: 'idle' });
  const [tick, setTick] = useState(0);
  const recheck = useCallback(() => setTick((n) => n + 1), []);
  const key = hashes.join(',');
  useEffect(() => {
    if (!hashes.length || !agreement) return setState({ status: 'idle' });
    let live = true;
    (async () => {
      const results: RegistrationJudgement[] = [];
      for (const h of hashes) {
        const lookup = await lookupRegistration(registry, h, (progress) => live && setState({ status: 'checking', progress }));
        results.push(judgeRegistration(agreement, lookup));
      }
      if (live) setState({ status: 'done', results });
    })().catch((e: unknown) => live && setState({ status: 'error', error: errText(e) }));
    return () => {
      live = false;
    };
  }, [registry, key, agreement, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, recheck };
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
