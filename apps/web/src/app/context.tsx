// App-wide settings: the network profile (Testnet / Mainnet) and the colour theme. Switching network signs out (AccountProvider).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadProfile, PROFILES, saveProfile, type ProfileId, type Registry } from '../config/registry.ts';

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'cairn.theme';

interface AppCtx {
  registry: Registry;
  setProfile(id: ProfileId): void;
  theme: Theme;
  setTheme(t: Theme): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function loadTheme(): Theme {
  try {
    const t = storage()?.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** `data-theme` on <html> overrides the system preference; "system" removes it. */
export function applyTheme(t: Theme): void {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<ProfileId>(() => loadProfile(storage()));
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const setProfile = useCallback((id: ProfileId) => {
    saveProfile(storage(), id);
    setProfileState(id);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === 'system') storage()?.removeItem(THEME_KEY);
      else storage()?.setItem(THEME_KEY, t);
    } catch {
      /* the choice lasts for this page */
    }
    setThemeState(t);
  }, []);
  const value = useMemo(() => ({ registry: PROFILES[profile], setProfile, theme, setTheme }), [profile, setProfile, theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
