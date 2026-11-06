import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context.tsx';

export function PageHead({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

/** The network has no cairn contract yet (mainnet until it is registered): everything is read-only "coming soon". */
export function NotOpenHere({ compact = false }: { compact?: boolean }) {
  const { registry, setProfile } = useApp();
  return (
    <div className={`soon${compact ? ' soon-compact' : ''}`} data-testid="not-open-here">
      <p>
        <b>Cairn opens on {registry.label} soon.</b> Its records live in a Dash Platform contract that is not registered on {registry.label} yet; until then
        there is nothing to list here, and nothing can be saved.
      </p>
      {registry.network !== 'testnet' && (
        <p>
          Everything already works on Testnet, with test DASH that has no value.{' '}
          <button type="button" className="btn btn-s" onClick={() => setProfile('testnet')}>
            Switch to Testnet
          </button>
        </p>
      )}
    </div>
  );
}

/** A route whose feature arrives in a later delivery step: what it will do, and what to do meanwhile. */
export function NextUp({ title, lede, will, meanwhile }: { title: string; lede: ReactNode; will: ReactNode[]; meanwhile?: ReactNode }) {
  return (
    <div className="page">
      <PageHead title={title} lede={lede} />
      <section className="next-up" aria-labelledby="next-up-title">
        <h2 id="next-up-title">Coming in the next release</h2>
        <ul className="ticks">
          {will.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
        {meanwhile && <div className="next-meanwhile">{meanwhile}</div>}
      </section>
    </div>
  );
}

export function BackHome() {
  return <Link to="/">Back to the start</Link>;
}
