// @vitest-environment happy-dom
// S4: hiding a profile is a list in this browser, per network; a hidden person's group leaves the list until shown again.
import type { Group } from '@cairn/contract';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../app/account.tsx';
import { AppProvider } from '../app/context.tsx';
import { A, B, D, group, id } from '../matching/fixtures.ts';
import { click, render } from '../test/render.tsx';
import { HiddenProfiles } from './hidden.tsx';

const posts = vi.hoisted(() => ({ items: [] as Group[] }));
vi.mock('../data/lists.ts', async (orig) => ({
  ...(await orig<typeof import('../data/lists.ts')>()),
  useStatusList: (spec: { type: string }) => ({ status: 'ready', data: { items: spec.type === 'group' ? posts.items : [], more: false }, refreshing: false, reload: () => {}, showOlder: () => {} }),
}));
const { GroupsPage } = await import('../pages/GroupsPage.tsx');

const app = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      <AppProvider>
        <AccountProvider>{node}</AccountProvider>
      </AppProvider>
    </MemoryRouter>,
  );
const rows = (el: HTMLElement) => el.querySelectorAll('[data-testid="group-rows"] > li').length;

describe('hidden profiles', () => {
  beforeEach(() => {
    localStorage.setItem('cairn.profile.v1', 'testnet');
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    posts.items = [group({ id: id(91), ownerId: A, roster: [{ id: A, amount: D(300) }] }), group({ id: id(92), ownerId: B, roster: [{ id: B, amount: D(200) }] })];
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('drop a hidden person’s group from the list, and come back from Settings', async () => {
    localStorage.setItem('cairn.hidden.v1.testnet', JSON.stringify([A]));
    const page = await app(<GroupsPage />);
    expect(rows(page.el)).toBe(1);
    expect(page.el.querySelector('[data-testid="hidden-note"]')!.textContent).toContain('One profile you hid is not shown.');
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
