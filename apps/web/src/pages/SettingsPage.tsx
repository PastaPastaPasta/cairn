import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { useAuth } from '../auth/context.tsx';
import { RecoverFunds } from '../auth/Recover.tsx';
import { PROFILES, type ProfileId } from '../config/registry.ts';
import { ThemeSwitch, openSignIn } from '../ui/Account.tsx';
import { HiddenProfiles } from '../ui/hidden.tsx';
import { PageHead } from '../ui/states.tsx';
import { useScrollToHash } from '../ui/useScrollToHash.ts';

const NET_TEXT: Record<ProfileId, string> = {
  testnet: 'Test DASH with no value. Everything works end to end here, including forming a shared masternode.',
  mainnet: 'Real DASH. Opens for profiles and groups once the Cairn contract is registered; forming waits for v24 activation.',
};

export function SettingsPage() {
  const { registry, setProfile } = useApp();
  const { session } = useAccount();
  const auth = useAuth();
  const { hash } = useLocation();
  const recover = useRef<HTMLDetailsElement>(null);
  useScrollToHash(null);
  useEffect(() => {
    if (hash !== '#recover' || !recover.current) return;
    recover.current.open = true;
    recover.current.scrollIntoView();
  }, [hash]);
  return (
    <div className="page settings">
      <PageHead title="Settings" />
      <section className="settings-block" aria-labelledby="net-h">
        <h2 id="net-h">Network</h2>
        <p className="small muted">Switching network signs you out: accounts on Testnet and Mainnet are separate.</p>
        <div className="net-choices" role="radiogroup" aria-labelledby="net-h">
          {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
            <label key={id} className={`net-choice${registry.profile === id ? ' on' : ''}`}>
              <input type="radio" name="network" value={id} checked={registry.profile === id} onChange={() => setProfile(id)} data-testid={`net-${id}`} />
              <span className="net-choice-name">
                {PROFILES[id].label}
                {!PROFILES[id].contractId && <span className="tag">opens soon</span>}
              </span>
              <span className="small muted">{NET_TEXT[id]}</span>
            </label>
          ))}
        </div>
        {registry.contractId && (
          <details className="small muted">
            <summary>Technical details</summary>
            <p>
              Cairn contract on {registry.label}: <span className="mono-ish break">{registry.contractId}</span>
            </p>
          </details>
        )}
      </section>
      <section className="settings-block" aria-labelledby="theme-h">
        <h2 id="theme-h">Appearance</h2>
        <ThemeSwitch />
      </section>
      <section className="settings-block" aria-labelledby="acct-h">
        <h2 id="acct-h">Account</h2>
        {session ? (
          <div className="form-actions">
            {auth.session && (
              <button type="button" className="btn" onClick={() => auth.openSheet('passkeys')}>
                Passkeys
              </button>
            )}
            {auth.session && (
              <button type="button" className="btn" onClick={() => auth.openSheet('topup')}>
                Top up
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={auth.signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="form-actions">
            <button type="button" className="btn" onClick={openSignIn} disabled={!registry.contractId}>
              Sign in or create an account
            </button>
          </div>
        )}
      </section>
      <HiddenProfiles />
      <section className="settings-block" aria-label="Recover funds">
        <details id="recover" className="settings-disclosure" ref={recover}>
          <summary>Paid for an account and it didn't finish?</summary>
          <RecoverFunds />
        </details>
      </section>
    </div>
  );
}
