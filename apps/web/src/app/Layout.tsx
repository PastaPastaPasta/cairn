// The shell: header (mark, nav, network, account), the page, the footer. The sign-in sheet is mounted once here.
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AuthSheet } from '../auth/AuthSheet.tsx';
import { Wordmark } from '../ui/Mark.tsx';
import { AccountControl } from '../ui/Account.tsx';
import { useApp } from './context.tsx';

const NAV = [
  { to: '/groups', label: 'Groups' },
  { to: '/looking', label: 'Looking' },
  { to: '/operators', label: 'Operators' },
  { to: '/learn', label: 'Learn' },
];

export const REPO_URL = 'https://github.com/PastaPastaPasta/cairn';

function NetworkPill() {
  const { registry } = useApp();
  const ready = !!registry.contractId;
  return (
    <Link
      to="/settings"
      className={`net-pill net-${registry.network}${ready ? '' : ' net-soon'}`}
      title={ready ? `Showing ${registry.label}. Change in Settings.` : `${registry.label}: Cairn is not open here yet. Change in Settings.`}
      data-testid="network-pill"
    >
      <span className="net-dot" aria-hidden="true" />
      {registry.label}
      <span className="visually-hidden">{ready ? ' network (change in Settings)' : ' network, not open yet (change in Settings)'}</span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  // a route change moves focus to the page, so keyboard and screen-reader users start at its top
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname]);
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="top-in">
          <Link to="/" className="home-link" aria-label="Cairn home">
            <Wordmark />
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'on' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="top-end">
            <NetworkPill />
            <AccountControl />
          </div>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="main">
        {children}
      </main>
      <footer className="foot">
        <div className="foot-in">
          <div className="foot-brand">
            <Wordmark />
            <p className="foot-promise">Cairn never holds your coins or keys.</p>
          </div>
          <ul className="foot-links">
            <li>
              A <a href="https://dashhq.org">Dash HQ</a> product
            </li>
            <li>
              <a href={REPO_URL}>Source on GitHub</a>
            </li>
            <li>
              <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT license</a>
            </li>
            <li>
              <Link to="/settings">Settings</Link>
            </li>
          </ul>
        </div>
      </footer>
      <AuthSheet />
    </div>
  );
}
