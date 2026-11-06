// Sign-in state for the real sessions (@cairn/auth: seed, pasted key, passkey). The app has ONE signed-in session, held by
// AccountProvider (app/account.tsx) as the app-level `Session` (session/session.ts); a real sign-in is wrapped by appSessionFromAuth and handed to it, so
// every write goes through @cairn/auth's document writer. This provider adds what only real sessions have (funding records, the
// sign-in sheet, top-ups and passkeys). The signing key lives in memory only, shared with this browser's other open Cairn tabs
// (session/tabShare.ts); keeping it across browser restarts is opt-in and goes through the
// passkey vault, never plain storage.
import { storageFundingStore, type FundingStore, type Network, type PlatformPort, type Session } from '@cairn/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { appSessionFromAuth, type AppAuthSession } from '../session/authSession.ts';
import { createTabShare, type TabShare } from '../session/tabShare.ts';
import { getAuthDapi, getPlatformPort } from './runtime.ts';

export type SheetView = 'choose' | 'create' | 'phrase' | 'key' | 'passkey' | 'topup' | 'passkeys';

interface AuthCtx {
  /** The real auth session behind the app session, when the app is signed in through @cairn/auth. */
  session: Session | null;
  /** True while a session handed over by another tab is being signed in with. */
  restoring: boolean;
  /** Credits; null while unknown. */
  balance: bigint | null;
  network: Network;
  /** The cairn contract of this network (the passkey vault lives there); empty while it has none. */
  contractId: string;
  /** Signs in this tab and the other open tabs of this profile. */
  signIn(s: Session): void;
  /** Signs out this tab and the other open tabs of this profile. */
  signOut(): void;
  refreshBalance(): void;
  platform(): Promise<PlatformPort>;
  dapi(): ReturnType<typeof getAuthDapi>;
  store: FundingStore;
  sheet: SheetView | null;
  openSheet(v: SheetView): void;
  closeSheet(): void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Fired by `openSignIn()` (ui/SignIn.tsx): "Sign in to comment" buttons open the sheet. */
export const OPEN_SIGNIN_EVENT = 'cairn:signin';

/**
 * Every tab of an origin hears the tab-sharing channel, so the session is shared only where Cairn has its origin to itself: not
 * from a sub-path (GitHub Pages before the custom domain, where the account's other Pages sites share the origin).
 */
const SHARE_TABS = import.meta.env.BASE_URL === '/';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { registry } = useApp();
  const account = useAccount();
  const [sheet, setSheet] = useState<SheetView | null>(null);
  const [restoring, setRestoring] = useState(false);
  const share = useRef<TabShare | null>(null);
  const store = useMemo(() => storageFundingStore(localStorage), []);
  const platform = useCallback(() => getPlatformPort(registry), [registry]);
  const dapi = useCallback(() => getAuthDapi(registry), [registry]);

  const session = (account.session as Partial<AppAuthSession> | null)?.auth ?? null;
  const { signIn: accountSignIn, signOut: accountSignOut } = account;
  const signInHere = useCallback((s: Session) => accountSignIn(appSessionFromAuth(s, platform)), [accountSignIn, platform]);
  const signOutHere = useCallback(() => {
    accountSignOut(); // closes the app session, which ends the auth session (wipes the key and the seed)
    setSheet(null);
  }, [accountSignOut]);
  const signIn = useCallback((s: Session) => {
    signInHere(s);
    share.current?.announce(s);
  }, [signInHere]);
  const signOut = useCallback(() => {
    share.current?.signOut();
    signOutHere();
  }, [signOutHere]);

  // The other open tabs of this profile share the session . A new channel per
  // profile asks the open tabs for theirs, so a new tab, or a profile switch to one another tab is signed in to, comes up signed in.
  const current = useRef(session);
  useEffect(() => {
    current.current = session;
  }, [session]);
  // another tab signed out: the views that need the session close, a sign-in in progress here stays
  const drop = useCallback(() => {
    accountSignOut();
    setSheet((v) => (v === 'topup' || v === 'passkeys' ? null : v));
  }, [accountSignOut]);
  useEffect(() => {
    if (!SHARE_TABS) return;
    const s = createTabShare({
      profile: `${registry.network}:${registry.contractId ?? ''}`,
      live: () => true,
      current: () => current.current,
      platform,
      adopt: signInHere,
      drop,
      restoring: setRestoring,
    });
    share.current = s;
    s.request();
    return () => {
      share.current = null;
      s.close();
    };
  }, [registry.network, registry.contractId, platform, signInHere, drop]);

  // Leaving the page wipes this tab's copy (the other tabs keep theirs: nothing is announced), so a page restored from the
  // back/forward cache never shows a session whose key bytes are already zero (they would derive keys anyone can compute). The
  // restored page asks the open tabs for the session again.
  useEffect(() => {
    const onHide = () => {
      share.current?.suspend();
      signOutHere();
    };
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      signOutHere();
      share.current?.resume();
    };
    addEventListener('pagehide', onHide);
    addEventListener('pageshow', onShow);
    return () => {
      removeEventListener('pagehide', onHide);
      removeEventListener('pageshow', onShow);
    };
  }, [signOutHere]);
  useEffect(() => {
    const open = () => setSheet('choose');
    addEventListener(OPEN_SIGNIN_EVENT, open);
    return () => removeEventListener(OPEN_SIGNIN_EVENT, open);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session, restoring: restoring && !session, balance: session ? account.balance : null, network: registry.network, contractId: registry.contractId ?? '', signIn, signOut,
      refreshBalance: account.refreshBalance, platform, dapi, store, sheet, openSheet: setSheet, closeSheet: () => setSheet(null),
    }),
    [session, restoring, account.balance, account.refreshBalance, registry.network, registry.contractId, signIn, signOut, platform, dapi, store, sheet],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
