// @vitest-environment happy-dom
// What the guide and the home page promise about coins, leaving and stolen keys must match Dash Core v24.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../app/context.tsx';
import { render } from '../test/render.tsx';
import { HomePage } from './HomePage.tsx';
import { LearnPage } from './LearnPage.tsx';

const text = async (node: React.ReactNode) => {
  const r = await render(<MemoryRouter>{node}</MemoryRouter>);
  const t = (r.el.textContent ?? '').replace(/\s+/g, ' ');
  await r.unmount();
  return t;
};

// claims a collateral output in nobody's wallet, the early penalty and single-masternode payouts contradict
const WRONG = [/stays? in (?:your|its owner’s) wallet/i, /never leaves your wallet/i, /every member gets their full share back/i, /part of every block reward/i, /Earn together/];

describe('custody and leaving copy', () => {
  beforeEach(() => {
    localStorage.setItem('cairn.profile.v1', 'mainnet'); // no contract there: no Platform reads
    vi.stubGlobal('fetch', () => new Promise(() => {}));
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('the home page says where a share goes and that leaving early costs the penalty', async () => {
    const t = await text(
      <AppProvider>
        <HomePage />
      </AppProvider>,
    );
    for (const w of WRONG) expect(t).not.toMatch(w);
    expect(t).toContain('every share stays in its owner’s control');
    expect(t).toContain('goes into a collateral only a dissolution can spend');
    expect(t).toContain('minus any agreed early penalty if you leave early');
    expect(t).toContain('Share the rewards');
    expect(t).toContain('Your Dash Core wallet’s keys or recovery phrase. Your Cairn account phrase is a separate one that only signs your profile and approvals.');
  });

  it('the guide states what a stolen owner key can cost', async () => {
    const t = await text(<LearnPage />);
    for (const w of WRONG) expect(t).not.toMatch(w);
    expect(t).toContain(
      'No single person can. A dissolution one owner signs must refund every share. A stolen owner key can cost its owner at most the agreed penalty plus 0.01 DASH; the others get their full share plus the penalty.',
    );
    expect(t).toContain('each block pays part of its reward to one masternode');
    expect(t).toContain('the leaver’s minus any agreed early penalty');
  });

  it('the guide names the Cairn account phrase and does not tell people both to keep it Cairn-only and to reuse it', async () => {
    const t = await text(<LearnPage />);
    expect(t).toContain('Its Cairn account phrase is a Dash Platform identity phrase: it also opens this account in other Platform apps. Don’t put real money on it.');
    expect(t).toContain('Your Dash Core wallet’s recovery phrase or private keys');
    expect(t).not.toMatch(/Cairn recovery phrase|keep it for Cairn only/);
  });
});
