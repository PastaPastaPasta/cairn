// The signed-in Session (session/session.ts) and its balance, shared by every page; govhub's ForumProvider without the forum.
// Every write goes through the session, i.e. @cairn/auth's one document writer.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DocumentOp, DocumentResult, Session } from '../session/session.ts';
import { endSession } from '../session/end.ts';
import { useApp } from './context.tsx';
import { assertCanAffordWrite, topUpFromError } from './funds.ts';

interface AccountCtx {
  session: Session | null;
  signIn(s: Session): void;
  signOut(): void;
  /** Credits; null while unknown. */
  balance: bigint | null;
  refreshBalance(): void;
  /** Signs and broadcasts through the session, then refreshes the balance. Throws when signed out, and a TopUpError when the balance is too low. */
  write(op: DocumentOp): Promise<DocumentResult>;
}

const Ctx = createContext<AccountCtx | null>(null);

export function useAccount(): AccountCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAccount outside AccountProvider');
  return c;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { registry } = useApp();
  const [session, setSessionState] = useState<Session | null>(null);
  // Replaced or ended synchronously (not in a state updater React may run later): the key is wiped before the click or `pagehide`
  // handler returns.
  const sessionRef = useRef<Session | null>(null);
  const setSession = useCallback((next: Session | null) => {
    const old = sessionRef.current;
    if (old === next) return;
    endSession(next?.identityId ?? null);
    sessionRef.current = next;
    old?.close();
    setSessionState(next);
  }, []);
  const [balance, setBalance] = useState<bigint | null>(null);
  const balanceRef = useRef<bigint | null>(null);
  balanceRef.current = balance;

  // Another network is another identity space: sign out.
  useEffect(() => () => setSession(null), [registry.network, setSession]);

  const refreshBalance = useCallback(() => {
    if (!session) return setBalance(null);
    session.balance().then(setBalance, () => setBalance(null));
  }, [session]);
  useEffect(refreshBalance, [refreshBalance]);

  const signIn = useCallback((s: Session) => setSession(s), [setSession]);
  const signOut = useCallback(() => setSession(null), [setSession]);

  const write = useCallback(
    async (op: DocumentOp) => {
      if (!session) throw new Error('Sign in first.');
      try {
        assertCanAffordWrite(balanceRef.current);
      } catch (e) {
        refreshBalance();
        throw e;
      }
      try {
        return await session.signAndBroadcastDocument(op);
      } catch (e) {
        throw topUpFromError(e);
      } finally {
        refreshBalance();
      }
    },
    [session, refreshBalance],
  );

  const value = useMemo<AccountCtx>(() => ({ session, signIn, signOut, balance, refreshBalance, write }), [session, signIn, signOut, balance, refreshBalance, write]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
