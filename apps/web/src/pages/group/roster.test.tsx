// @vitest-environment happy-dom
// Who is in: the bold name is the profile name, else the share's label in Dash-Qt; the label shows separately only when it differs.
// Seat requests from a profile the viewer hid fold away (S4).
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../../app/context.tsx';
import type { Person } from '../../data/people.ts';
import { A, B, C, D, group, opAccept, seat } from '../../matching/fixtures.ts';
import { groupView } from '../../matching/group.ts';
import { click, render } from '../../test/render.tsx';
import type { GroupOps } from './ops.ts';
import { Roster } from './Roster.tsx';

const person = (id: string, name: string): Person => ({ id, profile: null, dpns: null, name }) as unknown as Person;
const view = () =>
  groupView(
    {
      group: group({ roster: [{ id: A, amount: D(600), label: 'Alice' }, { id: B, amount: D(300), label: 'Bo' }] }),
      seats: [seat(A, D(600)), seat(B, D(300)), seat(C, D(100))],
      opAccepts: [opAccept()],
      invites: [],
      approvals: [],
      voided: [],
    },
    'testnet',
  );
const show = (people: Map<string, Person>) =>
  render(
    <MemoryRouter>
      <AppProvider>
        <Roster view={view()} people={people} me={null} ops={{} as GroupOps} done={() => {}} />
      </AppProvider>
    </MemoryRouter>,
  );

describe('the roster', () => {
  afterEach(() => localStorage.clear());

  it('names each share once: profile name, else the Dash-Qt label', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const r = await show(new Map([[A, person(A, 'Ana Demo')]]));
    const rows = [...r.el.querySelectorAll('[data-testid="roster"] > li')].map((li) => li.querySelector('.roster-who')!.textContent);
    expect(rows[0]).toContain('Ana Demo');
    expect(rows[0]).toContain('label in Dash-Qt: Alice');
    expect(rows[1]).toContain('Bo (label in Dash-Qt)');
    expect(rows[1]).not.toContain('label in Dash-Qt:');
    await r.unmount();
    vi.unstubAllGlobals();
  });

  it('folds away a request from a hidden profile, and shows it on request', async () => {
    localStorage.setItem('cairn.hidden.v1.testnet', JSON.stringify([C]));
    const r = await show(new Map());
    expect(r.el.querySelectorAll('[data-testid="request"]')).toHaveLength(0);
    await click(r.el.querySelector<HTMLButtonElement>('[data-testid="show-hidden-requests"]')!);
    expect(r.el.querySelectorAll('[data-testid="request"]')).toHaveLength(1);
    await r.unmount();
  });
});
