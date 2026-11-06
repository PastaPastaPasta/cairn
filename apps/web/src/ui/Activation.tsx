// Mainnet v24 activation, live from Radar. Matching and agreeing work before it; forming a shared masternode on mainnet waits for it.
import { useEffect, useState } from 'react';
import { ACTIVATION_PAGE, fetchActivation, type Activation } from '../data/activation.ts';

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const n = (x: number) => x.toLocaleString('en-US');

export function activationWords(a: Activation): { title: string; detail: string; step: number } {
  if (a.active) return { title: 'Shared masternodes are live on mainnet', detail: 'Dash Core v24 is active. Groups can form their masternode in Dash Core.', step: 3 };
  if (a.state === 'locked_in')
    return { title: 'Locked in on mainnet', detail: a.earliest ? `Activates at block ${n(a.earliest.height)}, around ${day(a.earliest.time)}.` : 'Activation follows within one signalling window.', step: 2 };
  if (a.state === 'started' && a.window) {
    const need = a.window.threshold ? ` of the ${n(a.window.threshold)} needed` : '';
    return { title: 'Miners are signalling for v24', detail: `${n(a.window.count)} blocks signalled in this window so far${need}.${a.earliest ? ` Earliest activation around ${day(a.earliest.time)}.` : ''}`, step: 1 };
  }
  return {
    title: 'Waiting for mainnet signalling',
    detail: `${a.startTime ? `Signalling opens ${day(a.startTime)}. ` : ''}${a.earliest ? `Earliest activation around ${day(a.earliest.time)} (block ${n(a.earliest.height)}).` : ''}`.trim(),
    step: 0,
  };
}

const STEPS = ['Signalling opens', 'Miners signal', 'Locked in', 'Active'];

export function ActivationCard({ initial }: { initial?: Activation }) {
  const [a, setA] = useState<Activation | null | undefined>(initial);
  useEffect(() => {
    if (initial) return;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    fetchActivation(ac.signal).then(setA, () => setA(null));
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [initial]);
  const w = a ? activationWords(a) : null;
  return (
    <section className="activation" aria-labelledby="activation-title" data-testid="activation-card" aria-busy={a === undefined}>
      <h2 id="activation-title" className="activation-title">
        {w ? w.title : a === null ? 'Mainnet status unavailable right now' : 'Reading mainnet status…'}
      </h2>
      {w && (
        <ol className="activation-steps" aria-label="Activation progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i < w.step ? 'done' : i === w.step ? 'now' : ''} aria-current={i === w.step ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
      )}
      <p className="activation-detail">
        {w?.detail ?? (a === null ? 'Radar did not answer. Profiles, listings and agreeing on terms work either way.' : ' ')}
      </p>
      <p className="small muted">
        On testnet, v24 has been active since block 1,578,000, so the whole flow works there today.{' '}
        <a href={ACTIVATION_PAGE}>Activation details on Radar</a>
        {a?.tipHeight ? <span className="num"> (mainnet block {n(a.tipHeight)})</span> : null}
      </p>
    </section>
  );
}
