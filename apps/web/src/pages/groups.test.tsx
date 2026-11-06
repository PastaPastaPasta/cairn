// @vitest-environment happy-dom
// /groups opens on every group that is not closed, says plainly when none is taking co-owners, and offers "Clear filters" only
// once a filter is set (D-006). Signed-in Home leads with my next step (D-005).
import { GROUP_STATUS, type Group } from '@cairn/contract';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../app/account.tsx';
import { AppProvider } from '../app/context.tsx';
import { A, B, D, ORG, group, id, opAccept, seat } from '../matching/fixtures.ts';
import { groupView } from '../matching/group.ts';
import { nextSteps } from '../matching/nextstep.ts';
import { click, render } from '../test/render.tsx';
import { NextStepList } from './me/MyGroups.tsx';

const list = vi.hoisted(() => ({ items: [] as Group[], statuses: [] as number[][] }));
vi.mock('../data/lists.ts', async (orig) => ({
  ...(await orig<typeof import('../data/lists.ts')>()),
  useStatusList: (_spec: unknown, statuses: number[]) => {
    list.statuses.push([...statuses]);
    return { status: 'ready', data: { items: list.items, more: false }, refreshing: false, reload: () => {}, showOlder: () => {} };
  },
}));
const chain = vi.hoisted(() => ({ primary: null as null | { state: string; mnState: string } }));
vi.mock('../formation/useRegistration.ts', async (orig) => ({
  ...(await orig<typeof import('../formation/useRegistration.ts')>()),
  useGroupRegistrations: (v: { linked: unknown[] }) => ({ state: { status: 'idle' }, recheck: () => {}, primary: v.linked.length ? chain.primary : null }),
}));
const { GroupsPage } = await import('./GroupsPage.tsx');

const show = () =>
  render(
    <MemoryRouter>
      <AppProvider>
        <AccountProvider>
          <GroupsPage />
        </AccountProvider>
      </AppProvider>
    </MemoryRouter>,
  );

describe('/groups', () => {
  beforeEach(() => {
    localStorage.setItem('cairn.profile.v1', 'testnet');
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    list.items = [];
    list.statuses = [];
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('says no group is taking co-owners, without a filter to clear', async () => {
    const r = await show();
    expect(r.el.textContent).toContain('No group is taking co-owners on Testnet right now.');
    expect(r.el.textContent).not.toContain('Clear filters');
    expect(r.el.querySelector('a[href="/looking"]')).not.toBeNull();
    await r.unmount();
  });

  it('lists ready and live groups by default and reads closed ones only behind the toggle', async () => {
    list.items = [group({ id: id(41), title: 'Locked one', status: GROUP_STATUS.locked }), group({ id: id(42), title: 'Live one', status: GROUP_STATUS.live })];
    const r = await show();
    expect(r.el.querySelectorAll('[data-testid="group-rows"] > li')).toHaveLength(2);
    expect(list.statuses.at(-1)).toEqual([GROUP_STATUS.forming, GROUP_STATUS.full, GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live]);
    const toggle = r.el.querySelector<HTMLInputElement>('[data-testid="filter-closed"]')!;
    await click(toggle);
    expect(list.statuses.at(-1)).toContain(GROUP_STATUS.cancelled);
    expect(list.statuses.at(-1)).toContain(GROUP_STATUS.dissolved);
    await r.unmount();
  });

  it('offers to clear filters only when one is set', async () => {
    list.items = [group({ id: id(41), title: 'Live one', status: GROUP_STATUS.live })];
    const r = await show();
    const sel = r.el.querySelector<HTMLSelectElement>('[data-testid="filter-status"]')!;
    await act(async () => {
      sel.value = 'forming';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(r.el.querySelector('[data-testid="groups-empty"]')!.textContent).toContain('No group matches these filters.');
    expect(r.el.textContent).toContain('Clear filters');
    await r.unmount();
  });
});

describe('signed-in Home', () => {
  it('shows the most pressing step in each of my open groups', async () => {
    const g = group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.full, title: 'Lisbon node' });
    const view = groupView({ group: g, seats: [seat(A, D(600))], opAccepts: [opAccept()], invites: [], approvals: [], voided: [] }, 'testnet');
    const r = await render(
      <MemoryRouter>
        <NextStepList groups={[{ view, steps: nextSteps(view, { id: B }), formByPassed: true }]} me={B} />
      </MemoryRouter>,
    );
    const band = r.el.querySelector('[data-testid="next-band"]')!;
    expect(band.textContent).toContain('Your next step');
    expect(band.textContent).toContain('Lisbon node');
    expect(band.textContent).toContain('Confirm your seat');
    expect(band.textContent).toContain('release them');
    expect(band.querySelector('a.btn')!.textContent).toBe('Do it');
    await r.unmount();
    const none = await render(
      <MemoryRouter>
        <NextStepList groups={[{ view: { ...view, closed: true }, steps: nextSteps(view, { id: ORG }), formByPassed: false }]} me={ORG} />
      </MemoryRouter>,
    );
    expect(none.el.querySelector('[data-testid="next-band"]')).toBeNull();
    await none.unmount();
  });

  it('takes a linked group’s step from the chain check, as /me does', async () => {
    const g = group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.live, proTxHash: 'ab'.repeat(32), title: 'Porto node' });
    const view = groupView({ group: g, seats: [seat(A, D(600)), seat(B, D(400))], opAccepts: [opAccept()], invites: [], approvals: [], voided: [] }, 'testnet');
    expect(view.linked.length).toBe(1);
    chain.primary = { state: 'recorded-after', mnState: 'valid' };
    const r = await render(
      <MemoryRouter>
        <NextStepList groups={[{ view, steps: nextSteps(view, { id: B }), formByPassed: false }]} me={B} />
      </MemoryRouter>,
    );
    expect(r.el.querySelector('[data-testid="next-band"]')!.textContent).toContain('Registered, but not verified');
    await r.unmount();
    chain.primary = { state: 'mismatch', mnState: 'valid' };
    const bad = await render(
      <MemoryRouter>
        <NextStepList groups={[{ view, steps: nextSteps(view, { id: B }), formByPassed: false }]} me={B} />
      </MemoryRouter>,
    );
    expect(bad.el.querySelector('[data-testid="next-band"]')!.textContent).toContain('The linked registration does not match');
    await bad.unmount();
    chain.primary = null;
  });
});
