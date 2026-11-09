// @vitest-environment happy-dom
// /groups is the one place to find a group (DESIGN §4.1): with no amount it lists every group that is not closed by where it is, and
// says plainly when none is taking co-owners (D-006); with an amount it ranks the groups that amount fits and offers to start one.
// Signed-in Home leads with my next step (D-005).
import { GROUP_STATUS, type Group } from '@cairn/contract';
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
  useStatusList: (spec: { type: string }, statuses: number[]) => {
    if (spec.type === 'group') list.statuses.push([...statuses]);
    return { status: 'ready', data: { items: spec.type === 'group' ? list.items : [], more: false }, refreshing: false, reload: () => {}, showOlder: () => {} };
  },
}));
const chain = vi.hoisted(() => ({ primary: null as null | { state: string; mnState: string } }));
vi.mock('../formation/useRegistration.ts', async (orig) => ({
  ...(await orig<typeof import('../formation/useRegistration.ts')>()),
  useGroupRegistrations: (v: { linked: unknown[] }) => ({ state: { status: 'idle' }, recheck: () => {}, primary: v.linked.length ? chain.primary : null }),
}));
const { GroupsPage } = await import('./GroupsPage.tsx');

const show = (url = '/groups') =>
  render(
    <MemoryRouter initialEntries={[url]}>
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

  it('says no group is taking co-owners, and how to start the first', async () => {
    const r = await show();
    expect(r.el.textContent).toContain('No group is taking co-owners on Testnet right now.');
    expect(r.el.querySelector('a[href="/groups#ask"]')!.textContent).toBe('Start a group');
    expect(r.el.querySelector('a[href="/looking"]')).toBeNull();
    await r.unmount();
  });

  it('lists every group that is not closed by where it is, and reads closed ones only behind the toggle', async () => {
    list.items = [group({ id: id(41), title: 'Locked one', status: GROUP_STATUS.locked }), group({ id: id(42), title: 'Live one', status: GROUP_STATUS.live })];
    const r = await show();
    expect(r.el.querySelectorAll('[data-testid="group-rows"] > li')).toHaveLength(2);
    expect([...r.el.querySelectorAll('.browse-section h2')].map((h) => h.textContent)).toEqual(['Agreeing terms or forming 1', 'Formed 1']);
    expect(list.statuses.at(-1)).toEqual([GROUP_STATUS.forming, GROUP_STATUS.full, GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live]);
    await click(r.el.querySelector<HTMLInputElement>('[data-testid="filter-closed"]')!);
    expect(list.statuses.at(-1)).toContain(GROUP_STATUS.cancelled);
    expect(list.statuses.at(-1)).toContain(GROUP_STATUS.dissolved);
    await r.unmount();
  });

  it('ranks the groups an amount fits, drawn with you in them, and still offers to start one', async () => {
    list.items = [
      group({ id: id(43), title: 'Half full', ownerId: A, operatorId: null, roster: [{ id: A, amount: D(500) }] }),
      group({ id: id(44), title: 'Nearly full', roster: [{ id: A, amount: D(400) }, { id: B, amount: D(300) }] }),
      group({ id: id(45), title: 'Too full', roster: [{ id: A, amount: D(850) }] }),
      group({ id: id(46), title: 'Invitation only', roster: [{ id: A, amount: D(300) }], flags: 0 }),
    ];
    const r = await show('/groups?amount=300');
    expect(r.el.querySelector('#fits-title')!.textContent).toBe('2 groups your 300 DASH fits');
    const cards = [...r.el.querySelectorAll('[data-testid="fit-card"]')];
    expect(cards.map((c) => c.querySelector('.fit-title')!.textContent)).toEqual(['Nearly full', 'Half full']);
    expect(cards[0]!.textContent).toContain('Your 300 DASH completes it.');
    expect(cards[1]!.textContent).toContain('With you, 200 DASH still to find.');
    expect(cards[1]!.textContent).toContain('Started by');
    expect(cards[0]!.querySelector('[data-testid="ask-to-join"]')!.getAttribute('href')).toBe(`/g/${id(44)}?amount=300#join`);
    const start = r.el.querySelector('[data-testid="start-card"]')!;
    expect(start.textContent).toContain('Or start your own group with 300 DASH');
    expect(start.querySelector('[data-testid="start-sign-in"]')).not.toBeNull();
    await r.unmount();
  });

  it('leads with starting a group when nothing fits, and explains an amount that cannot be a share', async () => {
    list.items = [group({ id: id(47), roster: [{ id: A, amount: D(850) }] })];
    const r = await show('/groups?amount=300');
    expect(r.el.querySelector('#fits-title')!.textContent).toBe('No group fits 300 DASH yet');
    expect(r.el.querySelector('[data-testid="start-card"]')!.textContent).toContain('Start a group with your 300 DASH');
    await r.unmount();
    const bad = await show('/groups?amount=50');
    expect(bad.el.textContent).toContain('A share is at least 100 DASH.');
    expect(bad.el.querySelector('[data-testid="start-card"]')).toBeNull();
    expect(bad.el.querySelector('[data-testid="browse"]')).not.toBeNull();
    await bad.unmount();
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
