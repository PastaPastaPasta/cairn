// @vitest-environment happy-dom
// S4: hiding a profile is a list in this browser, per network; a hidden person's post leaves the list until shown again.
import type { Looking } from '@cairn/contract';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../app/account.tsx';
import { AppProvider } from '../app/context.tsx';
import { A, B, D, looking } from '../matching/fixtures.ts';
import { click, render } from '../test/render.tsx';
import { HiddenProfiles } from './hidden.tsx';

const posts = vi.hoisted(() => ({ items: [] as Looking[] }));
vi.mock('../data/lists.ts', async (orig) => ({
  ...(await orig<typeof import('../data/lists.ts')>()),
  useStatusList: (spec: { type: string }) => ({ status: 'ready', data: { items: spec.type === 'looking' ? posts.items : [], more: false }, refreshing: false, reload: () => {}, showOlder: () => {} }),
}));
const { LookingPage } = await import('../pages/LookingPage.tsx');

const app = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      <AppProvider>
        <AccountProvider>{node}</AccountProvider>
      </AppProvider>
    </MemoryRouter>,
  );
const rows = (el: HTMLElement) => el.querySelectorAll('[data-testid="looking-rows"] > li').length;

describe('hidden profiles', () => {
  beforeEach(() => {
    localStorage.setItem('cairn.profile.v1', 'testnet');
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    posts.items = [looking(A, D(300), { id: 'post-a' }), looking(B, D(200), { id: 'post-b' })];
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('drop a hidden person’s post from the looking list, and come back from Settings', async () => {
    const page = await app(<LookingPage />);
    expect(rows(page.el)).toBe(2);
    await click(page.el.querySelector<HTMLButtonElement>('[data-testid="hide-profile"]')!);
    expect(rows(page.el)).toBe(1);
    expect(page.el.querySelector('[data-testid="hidden-note"]')!.textContent).toContain('One profile you hid is not shown.');
    expect(JSON.parse(localStorage.getItem('cairn.hidden.v1.testnet')!)).toEqual([A]);
    expect(localStorage.getItem('cairn.hidden.v1.mainnet')).toBeNull();

    const settings = await app(<HiddenProfiles />);
    expect(settings.el.querySelectorAll('[data-testid="unhide-profile"]')).toHaveLength(1);
    await click(settings.el.querySelector<HTMLButtonElement>('[data-testid="unhide-profile"]')!);
    expect(settings.el.textContent).toContain('You have not hidden anyone.');
    expect(rows(page.el)).toBe(2);
    await settings.unmount();
    await page.unmount();
  });

  it('follow another tab’s changes, and read a garbled list as nothing hidden', async () => {
    const settings = await app(<HiddenProfiles />);
    const fromOtherTab = (value: string) =>
      act(async () => {
        localStorage.setItem('cairn.hidden.v1.testnet', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'cairn.hidden.v1.testnet' }));
      });
    await fromOtherTab(JSON.stringify([B]));
    expect(settings.el.querySelectorAll('[data-testid="unhide-profile"]')).toHaveLength(1);
    await fromOtherTab('{not json');
    expect(settings.el.textContent).toContain('You have not hidden anyone.');
    await settings.unmount();
  });
});
