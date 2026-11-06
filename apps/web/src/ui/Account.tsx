// The header's account control. Signed out: "Sign in" (opens the sign-in sheet). Signed in: the identity's name, which opens the
// account menu (balance, profile, top-up, passkeys, settings, theme, sign out). Menu markup and classes follow govhub's SignIn.tsx.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp, type Theme } from '../app/context.tsx';
import { OPEN_SIGNIN_EVENT, useAuth } from '../auth/context.tsx';
import { CHANGE_COST_CREDITS, formatCreditsShort } from '../auth/runtime.ts';
import type { AppAuthSession } from '../session/authSession.ts';
import { personName, useProfile } from '../data/profile.ts';

/** Opens the sign-in sheet from anywhere ("Sign in to make a profile"). */
export const openSignIn = () => window.dispatchEvent(new Event(OPEN_SIGNIN_EVENT));

const THEMES: Array<{ id: Theme; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useApp();
  const group = useId();
  return (
    <fieldset className="seg theme-switch">
      <legend className="visually-hidden">Theme</legend>
      {THEMES.map((t) => (
        <label key={t.id} className={theme === t.id ? 'on' : ''}>
          <input type="radio" name={group} value={t.id} checked={theme === t.id} onChange={() => setTheme(t.id)} />
          {t.label}
        </label>
      ))}
    </fieldset>
  );
}

export function AccountControl() {
  const { session, balance } = useAccount();
  const auth = useAuth();
  const { registry } = useApp();
  const { profile, dpns } = useProfile(session?.identityId ?? null);
  const menu = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const hide = () => menu.current?.hidePopover?.();
  useEffect(() => {
    if (!session) hide();
    force((n) => n + 1);
  }, [session]);
  const name = personName(profile, dpns);
  const technical = (session as Partial<AppAuthSession> | null)?.technical;
  const item = (label: string, onClick: () => void, testId?: string) => (
    <button
      type="button"
      className="menu-item"
      data-testid={testId}
      onClick={() => {
        hide();
        onClick();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="account">
      {session ? (
        <button type="button" className="account-btn" popoverTarget="account-menu" data-testid="account-button">
          <span className="account-name">{name ?? `${session.identityId.slice(0, 6)}…`}</span>
        </button>
      ) : auth.restoring ? (
        <span className="small muted">Signing in…</span>
      ) : (
        <>
          {registry.contractId && (
            <button type="button" className="btn btn-primary btn-s" onClick={openSignIn} data-testid="signin-button">
              Sign in
            </button>
          )}
          <button type="button" className="icon-btn" popoverTarget="account-menu" aria-label="Settings and theme">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </>
      )}
      <div ref={menu} id="account-menu" popover="auto" className="account-menu" aria-label="Account and settings">
        {session && (
          <div className="menu-id">
            <p className="menu-name">{name ?? 'Your identity'}</p>
            {dpns && <p className="small">Dash username, proved by Platform{profile?.displayName ? <> · profile name {personName(profile, null)}</> : null}</p>}
            <p className="small muted break mono-ish" data-testid="session-identity">
              {session.identityId}
            </p>
            <p className="small">
              Account credit:{' '}
              <b data-testid="session-balance">{balance === null ? 'reading…' : formatCreditsShort(balance)}</b>
              {balance !== null && <span className="muted"> — enough for about {String(balance / CHANGE_COST_CREDITS)} changes</span>}
            </p>
            <p className="small muted">Signed in with {session.label}.</p>
            <p className="small muted">Signed in while Cairn is open in this browser. Use Sign out on shared computers.</p>
            <details className="small muted">
              <summary>Technical details</summary>
              {technical && <p>{technical}</p>}
            </details>
          </div>
        )}
        {session && (
          <Link className="menu-item" to="/me" onClick={hide}>
            My profile
          </Link>
        )}
        {session && auth.session && item('Top up', () => auth.openSheet('topup'))}
        {session && auth.session && item('Passkeys', () => auth.openSheet('passkeys'))}
        {!session && registry.contractId && item('Sign in or create an account', openSignIn)}
        <Link className="menu-item" to="/settings" onClick={hide}>
          Settings
        </Link>
        <div className="menu-theme">
          <span className="small muted">Theme</span>
          <ThemeSwitch />
        </div>
        {session && item('Sign out', auth.signOut, 'signout')}
      </div>
    </div>
  );
}
